import { useState } from "react";
import { ApiError, login, register, setToken, type UserPublic } from "../api";

/* ==========================================================
   登录/注册视图（M13）：无有效 token 时整屏展示，成功后进入主应用。
   账号落在团队共享用户库（alphasage_user），任何同事的机器都能登录。
   样式走 global.css 的 auth-* 区段，与主应用同一设计语言。
   ========================================================== */

const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;
const PASSWORD_RE = /^[\x20-\x7E]{6,64}$/;

export function AuthView({ onAuthed }: { onAuthed: (user: UserPublic) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  /** 切换登录/注册：清空全部输入与报错，两种模式各从零开始填 */
  const switchMode = (next: "login" | "register") => {
    if (busy || next === mode) return;
    setMode(next);
    setUsername("");
    setPassword("");
    setNickname("");
    setError("");
  };

  const submit = async () => {
    if (busy) return;
    setError("");
    if (!USERNAME_RE.test(username)) {
      setError("用户名须为 3~24 位字母/数字/下划线");
      return;
    }
    if (!PASSWORD_RE.test(password)) {
      setError("密码须为 6~64 位英文、数字或符号");
      return;
    }
    setBusy(true);
    try {
      const result =
        mode === "login"
          ? await login({ username, password })
          : await register({ username, password, nickname: nickname.trim() || undefined });
      setToken(result.token);
      onAuthed(result.user);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "操作失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-mark" aria-hidden="true">α</div>
          <div>
            <div className="auth-title">因子智投</div>
            <div className="auth-sub">AlphaSage Agent · 登录后策略与会话云端同步</div>
          </div>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="登录或注册">
          <button role="tab" aria-selected={mode === "login"}
            className={"auth-tab" + (mode === "login" ? " active" : "")}
            disabled={busy} onClick={() => switchMode("login")}>登录</button>
          <button role="tab" aria-selected={mode === "register"}
            className={"auth-tab" + (mode === "register" ? " active" : "")}
            disabled={busy} onClick={() => switchMode("register")}>注册</button>
        </div>

        <label className="auth-label" htmlFor="auth-username">用户名</label>
        <input id="auth-username" className="auth-input" value={username} maxLength={24}
          placeholder="3~24 位字母/数字/下划线" autoComplete="username"
          onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && void submit()} />

        <label className="auth-label" htmlFor="auth-password">密码</label>
        <input id="auth-password" className="auth-input" type="password" value={password} maxLength={64}
          placeholder="6~64 位字符"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && void submit()} />

        {mode === "register" && (
          <>
            <label className="auth-label" htmlFor="auth-nickname">昵称（可选，缺省同用户名）</label>
            <input id="auth-nickname" className="auth-input" value={nickname} maxLength={40}
              placeholder="展示用昵称" autoComplete="nickname"
              onChange={e => setNickname(e.target.value)} onKeyDown={e => e.key === "Enter" && void submit()} />
          </>
        )}

        {error && <div className="auth-error" role="alert">{error}</div>}

        <button className="btn btn-primary auth-submit" disabled={busy} onClick={() => void submit()}>
          {busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}
        </button>

        <div className="auth-hint">
          {mode === "register"
            ? "密码仅支持英文、数字与常用符号（6~64 位）"
            : "忘记密码请联系管理员重置"}
        </div>
      </div>
    </div>
  );
}
