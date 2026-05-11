use std::io::Write;
use std::process::{Command, Stdio};

#[derive(Clone, Copy)]
pub enum ClipboardSource {
    Clipboard,
    Primary,
}

impl ClipboardSource {
    pub fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "clipboard" => Ok(Self::Clipboard),
            "primary" => Ok(Self::Primary),
            _ => Err(format!("unknown clipboard source: {value}")),
        }
    }
}

pub fn read_text(source: ClipboardSource) -> Result<String, String> {
    let output = read_candidates(source)
        .into_iter()
        .find_map(|mut command| command.output().ok().filter(|output| output.status.success()))
        .ok_or_else(|| "failed to read clipboard text".to_string())?;

    String::from_utf8(output.stdout)
        .map_err(|error| format!("clipboard text is not valid UTF-8: {error}"))
}

pub fn write_text(source: ClipboardSource, text: &str) -> Result<(), String> {
    let mut last_error = None;

    for mut command in write_candidates(source) {
        command.stdin(Stdio::piped());

        match command.spawn() {
            Ok(mut child) => {
                if let Some(stdin) = child.stdin.as_mut() {
                    if let Err(error) = stdin.write_all(text.as_bytes()) {
                        last_error = Some(format!("failed to write clipboard stdin: {error}"));
                        continue;
                    }
                }

                if child.wait().map(|status| status.success()).unwrap_or(false) {
                    return Ok(());
                }
            }
            Err(error) => {
                last_error = Some(error.to_string());
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "failed to write clipboard text".to_string()))
}

fn read_candidates(source: ClipboardSource) -> Vec<Command> {
    if cfg!(target_os = "macos") {
        return vec![command("pbpaste", &[])];
    }

    match source {
        ClipboardSource::Clipboard => vec![
            command("wl-paste", &["--no-newline"]),
            command("xsel", &["--clipboard", "--output"]),
            command("xclip", &["-selection", "clipboard", "-o"]),
        ],
        ClipboardSource::Primary => vec![
            command("wl-paste", &["--primary", "--no-newline"]),
            command("xsel", &["--primary", "--output"]),
            command("xclip", &["-selection", "primary", "-o"]),
        ],
    }
}

fn write_candidates(source: ClipboardSource) -> Vec<Command> {
    if cfg!(target_os = "macos") {
        return vec![command("pbcopy", &[])];
    }

    match source {
        ClipboardSource::Clipboard => vec![
            command("wl-copy", &[]),
            command("xsel", &["--clipboard", "--input"]),
            command("xclip", &["-selection", "clipboard"]),
        ],
        ClipboardSource::Primary => vec![
            command("wl-copy", &["--primary"]),
            command("xsel", &["--primary", "--input"]),
            command("xclip", &["-selection", "primary"]),
        ],
    }
}

fn command(program: &str, args: &[&str]) -> Command {
    let mut command = Command::new(program);
    command.args(args);
    command
}
