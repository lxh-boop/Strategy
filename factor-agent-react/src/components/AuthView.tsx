import { useState, type CSSProperties } from "react";
import { ApiError, login, register, setToken, type UserPublic } from "../api";

/* ==========================================================
   登录/注册视图（M13）：无有效 token 时整屏展示，成功后进入主应用。
   账号落在团队共享用户库（alphasage_user），任何同事的机器都能登录。
   ========================================================== */

const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;
const PASSWORD_RE = /^[\x20-\x7E]{6,64}$/;

const s: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 100,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "linear-gradient(160deg, #eef0fe 0%, #f4f6fa 45%, #e8ecfb 100%)",
  },
  card: {
    width: 380, padding: "36px 32px", borderRadius: 16,
    background: "#fff", border: "1px solid #e5e9f0",
    boxShadow: "0 12px 40px rgba(31,41,72,.12)",
  },
  brand: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 },
  brandMark: {
    width: 34, height: 34, borderRadius: 10, background: "#4f5df0", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16,
  },
  title: { fontSize: 20, fontWeight: 700, color: "#1c2333" },
  sub: { fontSize: 12, color: "#98a1b3", marginBottom: 22 },
  tabs: { display: "flex", gap: 6, marginBottom: 18, background: "#f4f6fa", padding: 4, borderRadius: 10 },
  tab: {
    flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer",
    fontSize: 13, fontWeight: 600, background: "transparent", color: "#5a6478",
  },
  tabActive: { background: "#fff", color: "#4f5df0", boxShadow: "0 1px 4px rgba(31,41,72,.10)" },
  label: { display: "block", fontSize: 12, color: "#5a6478", margin: "12px 0 6px" },
  input: {
    width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14,
    borderRadius: 8, border: "1px solid #e5e9f0", outline: "none", color: "#1c2333",
  },
  error: {
    marginTop: 12, padding: "8px 10px", fontSize: 12, lineHeight: 1.5,
    borderRadius: 8, background: "#fdecec", color: "#c5303c",
  },
  submit: {
    width: "100%", marginTop: 18, padding: "11px 0", fontSize: 14, fontWeight: 600,
    borderRadius: 8, border: "none", cursor: "pointer", color: "#fff", background: "#4f5df0",
  },
  submitDisabled: { opacity: 0.6, cursor: "default" },
  hint: { marginTop: 14, fontSize: 11, color: "#98a1b3", lineHeight: 1.6 },
};

export function AuthView({ onAuthed }: { onAuthed: (user: UserPublic) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError("");
    if (!USERNAME_RE.test(username)) {
      setError("用户名须为 3~24 位字母/数字/下划线");
      return;
    }
    if (!PASSWORD_RE.test(password) || (mode === "login" && password.length < 6)) {
      setError("密码须为 6~64 位字符（注册仅支持可打印 ASCII）");
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
    <div style={s.overlay}>
      <div style={s.card}>
        <div style={s.brand}>
          <div style={s.brandMark}>α</div>
          <div>
            <div style={s.title}>因子智投</div>
            <div style={s.sub}>AlphaSage Agent · 登录后策略与会话云端同步</div>
          </div>
        </div>

        <div style={s.tabs}>
          <button style={{ ...s.tab, ...(mode === "login" ? s.tabActive : {}) }} onClick={() => { setMode("login"); setError(""); }}>登录</button>
          <button style={{ ...s.tab, ...(mode === "register" ? s.tabActive : {}) }} onClick={() => { setMode("register"); setError(""); }}>注册</button>
        </div>

        <label style={s.label}>用户名</label>
        <input style={s.input} value={username} maxLength={24} placeholder="3~24 位字母/数字/下划线"
          onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && void submit()} />

        <label style={s.label}>密码</label>
        <input style={s.input} type="password" value={password} maxLength={64} placeholder="6~64 位字符"
          onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && void submit()} />

        {mode === "register" && (
          <>
            <label style={s.label}>昵称（可选，缺省同用户名）</label>
            <input style={s.input} value={nickname} maxLength={40} placeholder="展示用昵称"
              onChange={e => setNickname(e.target.value)} onKeyDown={e => e.key === "Enter" && void submit()} />
          </>
        )}

        {error && <div style={s.error}>{error}</div>}

        <button style={{ ...s.submit, ...(busy ? s.submitDisabled : {}) }} disabled={busy} onClick={() => void submit()}>
          {busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}
        </button>

        <div style={s.hint}>
          {mode === "register" ? "密码仅支持可打印 ASCII（加密算法按字节处理，多字节字符有截断风险）" : "忘记密码请联系管理员重置"}
        </div>
      </div>
    </div>
  );
}
