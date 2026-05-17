use std::process::Child;
use std::sync::Mutex;

pub struct DaemonProcess(Mutex<Option<Child>>);

impl DaemonProcess {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }

    pub fn set_child(&self, child: Child) {
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
