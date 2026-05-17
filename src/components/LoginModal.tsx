import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { sf } from "../lib/tokens";

interface LoginModalProps {
  onClose: () => void;
}

export function LoginModal({ onClose }: LoginModalProps) {
  const [apiUrl, setApiUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setError(null);
    setLoading(true);

    try {
      await invoke("save_credentials", {
        apiUrl: apiUrl.trim(),
        email: email.trim(),
        password,
      });
      onClose();
    } catch (connectError) {
      const message =
        typeof connectError === "string"
          ? connectError
          : "Could not connect to ShellForge server";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="login-modal-overlay"
      style={{ backgroundColor: `${sf.colors.bg}e6` }}
    >
      <div
        className="login-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
      >
        <h1
          id="login-modal-title"
          className="login-modal-title"
          style={{
            fontFamily: sf.fonts.brand,
            fontStyle: "italic",
            fontSize: "20px",
            color: sf.colors.text,
          }}
        >
          ShellForge
        </h1>
        <p
          className="login-modal-subtitle"
          style={{
            fontFamily: sf.fonts.ui,
            fontSize: "12px",
            color: sf.colors.muted,
          }}
        >
          Connect to your ShellForge server
        </p>

        <label className="login-modal-field">
          <span className="login-modal-label">API URL</span>
          <input
            className="sf-input"
            type="url"
            placeholder="https://api.shellforge.dev"
            value={apiUrl}
            disabled={loading}
            onChange={(event) => setApiUrl(event.target.value)}
          />
        </label>

        <label className="login-modal-field">
          <span className="login-modal-label">Email</span>
          <input
            className="sf-input"
            type="email"
            autoComplete="username"
            value={email}
            disabled={loading}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="login-modal-field">
          <span className="login-modal-label">Password</span>
          <input
            className="sf-input"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={loading}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? (
          <p className="login-modal-error" style={{ color: "#c05050" }}>
            {error}
          </p>
        ) : null}

        <button
          type="button"
          className="btn-primary login-modal-connect"
          disabled={loading}
          onClick={() => void handleConnect()}
        >
          {loading ? "Connecting..." : "Connect"}
        </button>

        <button
          type="button"
          className="btn-ghost login-modal-skip"
          disabled={loading}
          onClick={onClose}
        >
          Skip for now, use offline
        </button>
      </div>
    </div>
  );
}
