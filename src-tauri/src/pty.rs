use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const DEFAULT_ROWS: u16 = 24;
const DEFAULT_COLS: u16 = 80;
const BASH_INIT_PATH: &str = "/tmp/shellforge_bash_init.sh";
const SF_RELOAD_PATH: &str = "/tmp/.sf_reload.sh";

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: String,
    data: String,
}

#[derive(Serialize)]
pub struct PtyCreated {
    id: String,
    title: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct AliasEntry {
    pub name: String,
    pub command: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct CommandEntry {
    pub name: String,
    pub script: String,
}

#[derive(Debug, Clone, Default)]
struct BashInitState {
    aliases: Vec<AliasEntry>,
    commands: Vec<CommandEntry>,
}

struct PtySession {
    child: Box<dyn Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
    bash_init: Mutex<BashInitState>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            bash_init: Mutex::new(BashInitState::default()),
        }
    }

    pub fn create(&self, app: AppHandle) -> Result<PtyCreated, String> {
        let bash_init = self
            .bash_init
            .lock()
            .map_err(|_| "bash init state is poisoned".to_string())?;
        write_bash_init_file(&bash_init.aliases, &bash_init.commands)?;

        let id = Uuid::new_v4().to_string();
        let size = PtySize {
            rows: DEFAULT_ROWS,
            cols: DEFAULT_COLS,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(size)
            .map_err(|error| format!("failed to open PTY: {error}"))?;

        let bash = bash_path();
        let mut command = CommandBuilder::new(&bash);
        command.args(["--rcfile", BASH_INIT_PATH, "-i"]);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("BASH_ENV", BASH_INIT_PATH);
        command.env("SHELL", bash.to_string_lossy().as_ref());

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("failed to spawn shell: {error}"))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("failed to clone PTY reader: {error}"))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("failed to open PTY writer: {error}"))?;

        let title = current_directory_title();
        let session = PtySession {
            child,
            master: pair.master,
            writer,
        };

        self.sessions
            .lock()
            .map_err(|_| "PTY session store is poisoned".to_string())?
            .insert(id.clone(), session);

        spawn_reader(id.clone(), reader, app);

        Ok(PtyCreated { id, title })
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "PTY session store is poisoned".to_string())?;

        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("unknown PTY session: {id}"))?;

        write_to_pty_writer(&mut session.writer, data)
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "PTY session store is poisoned".to_string())?;

        let session = sessions
            .get(id)
            .ok_or_else(|| format!("unknown PTY session: {id}"))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("failed to resize PTY: {error}"))
    }

    pub fn close(&self, id: &str) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "PTY session store is poisoned".to_string())?;

        if let Some(mut session) = sessions.remove(id) {
            session
                .child
                .kill()
                .map_err(|error| format!("failed to kill PTY child: {error}"))?;
        }

        Ok(())
    }

    pub fn rebuild_bash_init(
        &self,
        aliases: Vec<AliasEntry>,
        commands: Vec<CommandEntry>,
    ) -> Result<(), String> {
        let reload_script = {
            let mut bash_init = self
                .bash_init
                .lock()
                .map_err(|_| "bash init state is poisoned".to_string())?;
            bash_init.aliases = aliases;
            bash_init.commands = commands;
            write_bash_init_file(&bash_init.aliases, &bash_init.commands)?;
            prepare_pty_reload_injection(&bash_init.aliases, &bash_init.commands)?
        };

        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "PTY session store is poisoned".to_string())?;

        for session in sessions.values_mut() {
            write_to_pty_writer(&mut session.writer, &reload_script)?;
        }

        Ok(())
    }
}

#[tauri::command]
pub fn rebuild_bash_init(
    manager: tauri::State<'_, PtyManager>,
    aliases: Vec<AliasEntry>,
    commands: Vec<CommandEntry>,
) -> Result<(), String> {
    manager.rebuild_bash_init(aliases, commands)
}

fn spawn_reader(id: String, mut reader: Box<dyn Read + Send>, app: AppHandle) {
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];

        loop {
            let count = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => count,
                Err(error) => {
                    eprintln!("failed to read PTY output for {id}: {error}");
                    break;
                }
            };

            let data = String::from_utf8_lossy(&buffer[..count]).to_string();
            let output = PtyOutput {
                id: id.clone(),
                data,
            };

            if let Err(error) = app.emit("pty_output", output) {
                eprintln!("failed to emit PTY output for {id}: {error}");
                break;
            }
        }
    });
}

fn bash_path() -> PathBuf {
    ["/bin/bash", "/usr/bin/bash", "bash"]
        .iter()
        .map(PathBuf::from)
        .find(|candidate| candidate.exists())
        .unwrap_or_else(|| PathBuf::from("bash"))
}

fn write_to_pty_writer(writer: &mut dyn Write, data: &str) -> Result<(), String> {
    writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("failed to write to PTY: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("failed to flush PTY writer: {error}"))
}

fn prepare_pty_reload_injection(
    aliases: &[AliasEntry],
    commands: &[CommandEntry],
) -> Result<String, String> {
    fs::write(SF_RELOAD_PATH, format_aliases_and_commands(aliases, commands))
        .map_err(|error| format!("failed to write ShellForge reload script: {error}"))?;

    Ok(format!("\x15source {}\n\x15clear\n", SF_RELOAD_PATH))
}

fn format_aliases_and_commands(aliases: &[AliasEntry], commands: &[CommandEntry]) -> String {
    let mut lines = String::from("unalias -a 2>/dev/null\n");

    for alias in aliases {
        let name = sanitize_shell_name(&alias.name);
        if name.is_empty() {
            continue;
        }
        lines.push_str(&format!(
            "alias {name}='{}'\n",
            escape_single_quoted(&alias.command)
        ));
    }

    for command in commands {
        let name = sanitize_shell_name(&command.name);
        if name.is_empty() {
            continue;
        }
        lines.push_str(&format!(
            "{name}() {{ {} \"$@\"; }}\n",
            command.script.trim()
        ));
    }

    lines
}

fn write_bash_init_file(
    aliases: &[AliasEntry],
    commands: &[CommandEntry],
) -> Result<(), String> {
    let contents = generate_bash_init(aliases, commands);
    fs::write(BASH_INIT_PATH, contents)
        .map_err(|error| format!("failed to write ShellForge bash init: {error}"))
}

fn generate_bash_init(aliases: &[AliasEntry], commands: &[CommandEntry]) -> String {
    let mut contents = String::from(
        r#"# ShellForge bash initialization.
if [ -f "$HOME/.bashrc" ]; then
  source "$HOME/.bashrc"
fi

__sf_git_branch() {
  local branch
  branch=$(git -C "$PWD" symbolic-ref --short HEAD 2>/dev/null) || \
  branch=$(git -C "$PWD" rev-parse --short HEAD 2>/dev/null) || \
  { echo ""; return; }
  echo " (${branch})"
}

__sf_b64() {
  printf '%s' "$1" | base64 | tr -d '\n'
}

__sf_original_prompt_command=${PROMPT_COMMAND:-}
__sf_last_histcmd=$HISTCMD

__sf_prompt_command() {
  local exit_code=$?
  if [ -n "$__sf_original_prompt_command" ]; then
    eval "$__sf_original_prompt_command"
  fi

  local command cwd command_b64 cwd_b64
  command=""
  cwd=$PWD

  if [ "$HISTCMD" != "$__sf_last_histcmd" ]; then
    command=$(HISTTIMEFORMAT= history 1 | sed 's/^ *[0-9]\+ *//')
    __sf_last_histcmd=$HISTCMD
  fi

  command_b64=$(__sf_b64 "$command")
  cwd_b64=$(__sf_b64 "$cwd")
  printf '\e]777;ShellForgeHistory;%s;%s;%s\a' \
    "$command_b64" "$cwd_b64" "$exit_code"
}

PROMPT_COMMAND=__sf_prompt_command
PS1='${debian_chroot:+($debian_chroot)}\[\033[01;32m\]\u@\h\[\033[00m\] \[\033[01;34m\]\w\[\033[00m\]\[\033[97m\]$(__sf_git_branch)\[\033[00m\]> '
"#,
    );

    contents.push_str(&format_aliases_and_commands(aliases, commands));
    contents
}

fn sanitize_shell_name(name: &str) -> String {
    name.chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
        .collect()
}

fn escape_single_quoted(value: &str) -> String {
    value.replace('\'', "'\\''")
}

fn current_directory_title() -> String {
    std::env::current_dir()
        .ok()
        .as_deref()
        .map(directory_name)
        .unwrap_or_else(|| "Terminal".to_string())
}

fn directory_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "/".to_string())
}
