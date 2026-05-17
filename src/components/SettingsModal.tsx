import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { sf } from "../lib/tokens";

type SettingsSection = "account" | "sync";

interface SettingsModalProps {
  onClose: () => void;
  onLogout: () => void;
}

interface AccountInfo {
  api_url: string;
  connected: boolean;
  display_name: string | null;
  email: string;
  member_since: string;
  username: string;
}

interface SyncSettings {
  sync_aliases: boolean;
  sync_commands: boolean;
  sync_history: boolean;
  sync_tabs: boolean;
  sync_theme: boolean;
}

const SYNC_TOGGLES: Array<{ key: keyof SyncSettings; label: string }> = [
  { key: "sync_history", label: "Sync history" },
  { key: "sync_theme", label: "Sync theme" },
  { key: "sync_aliases", label: "Sync aliases" },
  { key: "sync_commands", label: "Sync commands" },
  { key: "sync_tabs", label: "Sync tabs" },
];

export function SettingsModal({ onClose, onLogout }: SettingsModalProps) {
  const [section, setSection] = useState<SettingsSection>("account");
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [syncSettings, setSyncSettings] = useState<SyncSettings | null>(null);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [savedToggle, setSavedToggle] = useState<string | null>(null);

  const loadSyncSettings = useCallback(async () => {
    const settings = await invoke<SyncSettings>("get_sync_settings");
    setSyncSettings(settings);
  }, []);

  useEffect(() => {
    void invoke<AccountInfo>("get_account_info")
      .then(setAccount)
      .catch((error) => console.error("failed to load account info", error));
  }, []);

  useEffect(() => {
    if (section === "account") {
      return;
    }

    void loadSyncSettings().catch((error) => {
      console.error("failed to load sync settings", error);
    });
  }, [loadSyncSettings, section]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  useEffect(() => {
    if (!savedToggle) {
      return undefined;
    }

    const timer = window.setTimeout(() => setSavedToggle(null), 1500);
    return () => window.clearTimeout(timer);
  }, [savedToggle]);

  const handleLogout = async () => {
    try {
      await invoke("logout");
      onLogout();
      onClose();
    } catch (error) {
      console.error("failed to log out", error);
    }
  };

  const handleToggle = async (key: keyof SyncSettings, value: boolean) => {
    if (!syncSettings || !account?.connected) {
      return;
    }

    const previous = { ...syncSettings };
    setSyncSettings({ ...syncSettings, [key]: value });

    try {
      await invoke("update_sync_setting", { key, value });
      setSavedToggle(key);
    } catch (error) {
      console.error("failed to update sync setting", error);
      setSyncSettings(previous);
    }
  };

  return (
    <div
      className="settings-modal-overlay"
      style={{ backgroundColor: `${sf.colors.bg}d9` }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-modal-header">
          <h2 className="settings-modal-title" id="settings-modal-title">
            Settings
          </h2>
          <button
            aria-label="Close settings"
            className="settings-modal-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="settings-modal-body">
          <nav className="settings-nav" aria-label="Settings sections">
            <button
              className={section === "account" ? "nav-item nav-item-active" : "nav-item"}
              onClick={() => setSection("account")}
              type="button"
            >
              Account
            </button>
            <button
              className={section === "sync" ? "nav-item nav-item-active" : "nav-item"}
              onClick={() => setSection("sync")}
              type="button"
            >
              Sync
            </button>
          </nav>

          <div className="settings-content">
            {section === "account" ? (
              <AccountSection
                account={account}
                logoutConfirm={logoutConfirm}
                onConfirmLogout={() => void handleLogout()}
                onRequestLogout={() => setLogoutConfirm(true)}
              />
            ) : null}
            {section === "sync" ? (
              <SyncSection
                account={account}
                savedToggle={savedToggle}
                settings={syncSettings}
                onToggle={(key, value) => void handleToggle(key, value)}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatMemberSince(createdAt: string): string | null {
  if (!createdAt) {
    return null;
  }

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const month = date.toLocaleString("en-US", { month: "long" });
  const year = date.getFullYear();
  return `Member since ${month} ${year}`;
}

function AccountSection({
  account,
  logoutConfirm,
  onConfirmLogout,
  onRequestLogout,
}: {
  account: AccountInfo | null;
  logoutConfirm: boolean;
  onConfirmLogout: () => void;
  onRequestLogout: () => void;
}) {
  if (!account) {
    return <p className="settings-muted">Loading account…</p>;
  }

  const memberSince = formatMemberSince(account.member_since);
  const displayName = account.display_name?.trim() || null;

  return (
    <div className="settings-section">
      <span className={account.connected ? "badge-online" : "badge-offline"}>
        {account.connected ? "Connected" : "Offline"}
      </span>

      {displayName ? (
        <label className="settings-field">
          <span className="settings-label">Display name</span>
          <input
            className="sf-input settings-input-readonly"
            readOnly
            value={displayName}
          />
        </label>
      ) : null}

      <label className="settings-field">
        <span className="settings-label">Username</span>
        <input
          className="sf-input settings-input-readonly"
          readOnly
          value={account.username || "—"}
        />
      </label>

      <label className="settings-field">
        <span className="settings-label">Email</span>
        <input
          className="sf-input settings-input-readonly"
          readOnly
          value={account.email || "—"}
        />
      </label>

      <label className="settings-field">
        <span className="settings-label">API URL</span>
        <input
          className="sf-input settings-input-readonly"
          readOnly
          value={account.api_url || "—"}
        />
      </label>

      {memberSince ? <p className="settings-member-since">{memberSince}</p> : null}

      <div className="settings-logout">
        {logoutConfirm ? (
          <div className="settings-logout-confirm">
            <span className="settings-muted">Are you sure?</span>
            <button className="btn-danger" onClick={onConfirmLogout} type="button">
              Confirm log out
            </button>
          </div>
        ) : (
          <button className="btn-danger" onClick={onRequestLogout} type="button">
            Log out
          </button>
        )}
      </div>
    </div>
  );
}

function SyncSection({
  account,
  settings,
  savedToggle,
  onToggle,
}: {
  account: AccountInfo | null;
  settings: SyncSettings | null;
  savedToggle: string | null;
  onToggle: (key: keyof SyncSettings, value: boolean) => void;
}) {
  if (!settings) {
    return <p className="settings-muted">Loading sync settings…</p>;
  }

  const connected = account?.connected ?? false;

  return (
    <div className="settings-section">
      {!connected ? (
        <p className="settings-muted">Connect your account to enable sync</p>
      ) : null}

      <ul className="settings-toggle-list">
        {SYNC_TOGGLES.map(({ key, label }) => (
          <li className="settings-toggle-row" key={key}>
            <span className="settings-toggle-label">{label}</span>
            <div className="settings-toggle-actions">
              {savedToggle === key ? (
                <span className="settings-saved">Saved</span>
              ) : null}
              <button
                aria-checked={settings[key]}
                aria-label={label}
                className={settings[key] ? "sf-toggle sf-toggle-active" : "sf-toggle"}
                disabled={!connected}
                onClick={() => onToggle(key, !settings[key])}
                role="switch"
                type="button"
              >
                <span className="sf-toggle-thumb" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}