import { useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui";
import type { DemoSession } from "../../lib/api/types";
import { api } from "../../lib/api/api";

export function LoginPage({
  onLogin,
}: {
  onLogin: (session: DemoSession) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      onLogin(await api.login(username.trim(), password));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to sign in. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login-screen">
      <div className="login-layout">
        <div className="login-brand">
          <div className="brand-mark">
            <span className="brand-plus">+</span>
          </div>
          <div>
            <span className="brand-name">Careflow</span>
            <span className="brand-caption">Clinic ERP</span>
          </div>
        </div>
        <section className="login-card">
          <div className="auth-label">
            <ShieldCheck size={14} />
            Sign in to Careflow
          </div>
          <h1>Sign in to Careflow</h1>
          <p className="intro">
            Use your clinic account credentials to access the system.
          </p>
          <form
            className="login-fields"
            onSubmit={(event) => {
              void submit(event);
            }}
          >
            <label className="form-field">
              <span>
                Username <span className="required-mark">*</span>
              </span>
              <input
                name="username"
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>
                Password <span className="required-mark">*</span>
              </span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <Button
              type="submit"
              variant="primary"
              className="login-submit"
              disabled={busy}
            >
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <p className="login-disclaimer">
            <Activity size={12} /> Your account access and clinic information are protected by your assigned role.
          </p>
        </section>
        <p className="login-footer">
          Careflow Clinic ERP
        </p>
      </div>
    </main>
  );
}
