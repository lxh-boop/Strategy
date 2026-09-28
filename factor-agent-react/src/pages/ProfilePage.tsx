import { useEffect, useState } from "react";
import type { ApiKeyEntry, SettingIcon, UserProfile } from "../types";
import { PROFILE } from "../data/mock";
import { ApiError, addApiKey, getProfile, removeApiKey, updateSetting } from "../api";
import { RadarChart } from "../components/charts";
import { Modal } from "../components/ui";
import {
  IconBell, IconClose, IconDatabase, IconFile, IconKey,
  IconPlus, IconShield, IconTrash,
} from "../components/icons";

const ICONS: Record<SettingIcon, () => JSX.Element> = {
  bell: IconBell,
  file: IconFile,
  key: IconKey,
  database: IconDatabase,
  shield: IconShield,
};

/* ----- API 密钥管理弹窗（增删直接落到后端，列表只显示服务端下发的脱敏值） ----- */

function ApiKeysModal({ keys, onClose, onAdd, onRemove, notify }: {
  keys: ApiKeyEntry[];
  onClose: () => void;
  onAdd: (name: string, key: string) => Promise<void>;
  onRemove: (name: string) => Promise<void>;
  notify: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim() || !value.trim()) { notify("请填写名称与密钥"); return; }
    setBusy(true);
    try {
      await onAdd(name.trim(), value.trim());
      setName("");
      setValue("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">API 密钥管理</div>
        <button className="icon-btn" onClick={onClose}><IconClose /></button>
      </div>
      <div className="modal-body">
        {keys.length ? keys.map(k => (
          <div className="key-row" key={k.name}>
            <span className="k-name">{k.name}</span>
            <span className="k-val">{k.key}</span>
            <button className="icon-btn" title="删除" onClick={() => void onRemove(k.name)}><IconTrash /></button>
          </div>
        )) : (
          <div className="agent-card-text">暂无密钥，添加后用于接入行情与回测数据服务。</div>
        )}
        <div className="key-add">
          <input className="text-input" placeholder="名称，如：聚宽行情数据"
            value={name} onChange={e => setName(e.target.value)} />
          <input className="text-input" placeholder="密钥"
            value={value} onChange={e => setValue(e.target.value)} />
          <button className="btn btn-ghost" disabled={busy} onClick={add}><IconPlus />添加</button>
        </div>
        <div className="agent-card-text" style={{ margin: "10px 0 0" }}>
          密钥提交后由后端保存，界面只展示脱敏值（如 jq_5****4f01），完整密钥不可再查看。
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-primary" onClick={onClose}>完成</button>
      </div>
    </Modal>
  );
}

/* ----- 单选/多选配置弹窗（数据源、风险偏好） ----- */

function ChoiceModal({ title, multi, choices, selected, onClose, onSave, notify }: {
  title: string;
  multi: boolean;
  choices: string[];
  selected: string[];
  onClose: () => void;
  onSave: (v: string[]) => Promise<void>;
  notify: (m: string) => void;
}) {
  const [sel, setSel] = useState<string[]>(selected);
  const [busy, setBusy] = useState(false);

  const toggle = (c: string) =>
    setSel(prev => {
      if (!multi) return [c];
      return prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c];
    });

  const save = async () => {
    if (!sel.length) { notify(multi ? "请至少选择一项" : "请选择一项"); return; }
    setBusy(true);
    try {
      await onSave(sel);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div className="modal-title">{title}</div>
        <button className="icon-btn" onClick={onClose}><IconClose /></button>
      </div>
      <div className="modal-body">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {choices.map(c => (
            <label key={c} className="factor-tag"
              style={{ cursor: "pointer", userSelect: "none", padding: "7px 13px", fontSize: 12 }}>
              <input type={multi ? "checkbox" : "radio"} name="choice" checked={sel.includes(c)}
                onChange={() => toggle(c)}
                style={{ accentColor: "var(--primary)", marginRight: 5, verticalAlign: -1 }} />
              {c}
            </label>
          ))}
        </div>
        {multi && (
          <div className="agent-card-text" style={{ margin: "10px 0 0" }}>
            可多选，选中的数据源将同时用于行情获取与回测。
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>保存</button>
      </div>
    </Modal>
  );
}

/* ----- 页面 ----- */

export function ProfilePage({ notify }: { notify: (m: string) => void }) {
  /* 先用内置兜底数据渲染，随后以 GET /api/user/profile 的结果为准 */
  const [profile, setProfile] = useState<UserProfile>(PROFILE);
  const [editing, setEditing] = useState<null | "apikey" | "datasrc" | "risk">(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const p = await getProfile();
        if (!cancelled) setProfile(p);
      } catch (e) {
        if (!cancelled) notify(e instanceof ApiError ? e.message : "个人中心加载失败，当前展示本地兜底数据");
      }
    })();
    return () => { cancelled = true; };
  }, [notify]);

  const setting = (key: string) => profile.settings.find(s => s.key === key);
  const risk = setting("risk")?.value ?? "—";
  const datasrcChoices = setting("datasrc")?.choices ?? [];
  const riskChoices = setting("risk")?.choices ?? [];

  const fail = (e: unknown, fallback: string) =>
    notify(e instanceof ApiError ? e.message : fallback);

  /** 乐观更新设置项，失败时回退并提示；返回是否保存成功 */
  const patchSetting = async (key: string, payload: { on?: boolean; value?: string; values?: string[] }, rollback: UserProfile): Promise<boolean> => {
    setProfile(p => ({
      ...p,
      settings: p.settings.map(s => {
        if (s.key !== key) return s;
        if (payload.on !== undefined) return { ...s, on: payload.on };
        if (payload.values !== undefined) return { ...s, value: payload.values.join(" + ") };
        return { ...s, value: payload.value };
      }),
    }));
    try {
      setProfile(await updateSetting({ key, ...payload }));
      return true;
    } catch (e) {
      setProfile(rollback);
      fail(e, "设置保存失败");
      return false;
    }
  };

  const toggleSetting = (key: string, on: boolean) => {
    const item = setting(key);
    void patchSetting(key, { on }, profile);
    if (item) notify(`「${item.title}」已${on ? "开启" : "关闭"}`);
  };

  const displayValue = (s: ProfileSettingKey): string =>
    setting(s)?.value ?? (s === "apikey" ? `已配置 ${profile.apiKeys.length} 个` : "未配置");

  const handleAddKey = async (name: string, key: string) => {
    try {
      setProfile(await addApiKey(name, key));
      notify(`密钥「${name}」已保存到后端`);
    } catch (e) {
      fail(e, "密钥保存失败");
      throw e;
    }
  };

  const handleRemoveKey = async (name: string) => {
    try {
      setProfile(await removeApiKey(name));
      notify(`密钥「${name}」已删除`);
    } catch (e) {
      fail(e, "密钥删除失败");
      throw e;
    }
  };

  return (
    <section id="page-profile" className="page active">
      <header className="page-header">
        <div>
          <h1>个人中心</h1>
          <p className="page-sub">账户信息与系统设置</p>
        </div>
      </header>

      <div className="profile-layout">
        <div className="profile-left">
          <div className="card user-card">
            <div className="uc-top">
              <div className="avatar uc-avatar">陈</div>
              <div>
                <div className="uc-name">{profile.name}</div>
                <div className="uc-desc">{profile.org}</div>
              </div>
              <span className="uc-plan">{profile.plan}</span>
            </div>
            <div className="uc-divider" />
            <div className="uc-rows">
              <div className="uc-row"><span className="k">注册时间</span><span className="v">{profile.registerDate}</span></div>
              <div className="uc-row"><span className="k">最近登录</span><span className="v">{profile.lastLogin}</span></div>
              <div className="uc-row"><span className="k">默认业绩基准</span><span className="v">沪深300指数</span></div>
              <div className="uc-row"><span className="k">风险偏好</span><span className="v">{risk}</span></div>
            </div>
          </div>

          <div className="card radar-card">
            <div className="card-title">因子偏好画像</div>
            <div className="card-sub">基于你近 90 天的策略构建与对话记录生成</div>
            {/* id 供 global.css 的 #radar-chart svg 尺寸规则使用 */}
            <div id="radar-chart" style={{ display: "flex", justifyContent: "center" }}>
              <RadarChart items={profile.radar} />
            </div>
            <div className="radar-legend"><span><i />偏好强度（0-100）</span></div>
          </div>
        </div>

        <div className="profile-right">
          <div className="card">
            <div className="card-title">偏好设置</div>
            <div>
              {profile.settings.map(s => {
                const Icon = ICONS[s.icon];
                const isToggle = s.type === "toggle";
                return (
                  <div key={s.key}
                    className={"setting-row" + (isToggle ? "" : " clickable")}
                    onClick={isToggle ? undefined : () => setEditing(s.key as "apikey" | "datasrc" | "risk")}>
                    <div className="setting-left">
                      <Icon />
                      <div className="setting-info">
                        <div className="s-title">{s.title}</div>
                        <div className="s-desc">{s.desc}</div>
                      </div>
                    </div>
                    {isToggle ? (
                      <label className="switch" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={s.on === true}
                          onChange={e => toggleSetting(s.key, e.target.checked)} />
                        <span className="track" />
                      </label>
                    ) : (
                      <span className="s-value">{displayValue(s.key as ProfileSettingKey)}<span className="s-edit">配置</span></span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card plan-card">
            <div className="plan-info">
              <div className="plan-tag">专业版会员</div>
              <div className="plan-desc">因子库全量开放 · 每月 200 次回测额度 · 专属数据源</div>
              <div className="plan-expire">2026-12-31 到期</div>
            </div>
            <button className="btn btn-outline-light" onClick={() => notify("续费流程即将上线（演示）")}>续费升级</button>
          </div>
        </div>
      </div>

      {editing === "apikey" && (
        <ApiKeysModal keys={profile.apiKeys} notify={notify}
          onClose={() => setEditing(null)}
          onAdd={handleAddKey}
          onRemove={handleRemoveKey} />
      )}
      {editing === "datasrc" && (
        <ChoiceModal title="数据源配置" multi choices={datasrcChoices}
          selected={(setting("datasrc")?.value ?? "").split(" + ").filter(Boolean)}
          notify={notify}
          onClose={() => setEditing(null)}
          onSave={async v => {
            if (!(await patchSetting("datasrc", { values: v }, profile))) return;
            setEditing(null);
            notify(`数据源已更新：${v.join(" + ")}`);
          }} />
      )}
      {editing === "risk" && (
        <ChoiceModal title="风险偏好" multi={false} choices={riskChoices} selected={[risk]} notify={notify}
          onClose={() => setEditing(null)}
          onSave={async v => {
            if (!(await patchSetting("risk", { value: v[0] }, profile))) return;
            setEditing(null);
            notify(`风险偏好已更新：${v[0]}`);
          }} />
      )}
    </section>
  );
}

type ProfileSettingKey = "notify" | "report" | "apikey" | "datasrc" | "risk";
