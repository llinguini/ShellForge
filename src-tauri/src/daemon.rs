use std::process::{Child, Command};
use std::sync::Mutex;

pub struct DaemonProcess(Mutex<Option<Child>>);

impl DaemonProcess {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }

    pub fn spawn_managed(&self) {
        let Ok(exe_path) = std::env::current_exe() else {
            return;
        };
        let Some(parent) = exe_path.parent() else {
            return;
        };

        let daemon_path = parent.join("shellforge-daemon");
        if !daemon_path.is_file() {
            return;
        }

        let Ok(child) = Command::new(daemon_path).spawn() else {
            return;
        };

        if let Ok(mut slot) = self.0.lock() {
            *slot = Some(child);
        }
    }
}

impl Drop for DaemonProcess {
    fn drop(&mut self) {
        let Ok(mut slot) = self.0.lock() else {
            return;
        };

        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
