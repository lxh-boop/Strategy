import { useEffect, useState } from "react";
import type { SettingIcon, UserProfile } from "../types";
import { PROFILE } from "../data/mock";
import { ApiError, getProfile, updateSetting } from "../api";
import { RadarChart } from "../components/charts";
import { Modal } from "../components/ui";
import {
  IconBell, IconClose, IconDatabase, IconFile, IconKey, IconShield,
} from "../components/icons";

const ICONS: Record<SettingIcon, () => JSX.Element> = {
  bell: IconBell,
  file: IconFile,
  key: IconKey,
  database: IconDatabase,
  shield: IconShield,
};

/* ----- 单选配置弹窗（风险偏好） ----- */

function ChoiceModal({ title, choices, selected, onClose, onSave, notify }: {
  title: string;
  choices: string[];
  selected: string[];
  onClose: () => void;
  onSave: (v: string[]) => Promise<void>;
  notify: (m: string) => void;
}) {
  const [sel, setSel] = useState<string[]>(selected);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!sel.length) { notify("请选择一项"); return; }
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
              <input type="radio" name="choice" checked={sel.includes(c)}
                onChange={() => setSel([c])}
                style={{ accentColor: "var(--primary)", marginRight: 5, verticalAlign: -1 }} />
              {c}
            </label>
          ))}
        </div>
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
  const [editing, setEditing] = useState<null | "risk">(null);

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
  const riskChoices = setting("risk")?.choices ?? [];

  const fail = (e: unknown, fallback: string) =>
    notify(e instanceof ApiError ? e.message : fallback);

  /** 乐观更新设置项，失败时回退并提示；返回是否保存成功 */
  const patchSetting = async (key: string, payload: { on?: boolean; value?: string }, rollback: UserProfile): Promise<boolean> => {
    setProfile(p => ({
      ...p,
      settings: p.settings.map(s => {
        if (s.key !== key) return s;
        if (payload.on !== undefined) return { ...s, on: payload.on };
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
                const isReadonly = s.type === "readonly";
                return (
                  <div key={s.key}
                    className={"setting-row" + (!isToggle && !isReadonly ? " clickable" : "")}
                    onClick={!isToggle && !isReadonly ? () => setEditing("risk") : undefined}>
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
                      <span className="s-value">{s.value ?? "—"}{!isReadonly && <span className="s-edit">配置</span>}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card plan-card">
            <div className="plan-info">
              <div className="plan-tag">专业版会员</div>
              <div className="plan-desc">因子库全量开放 · 每月 200 次回测额度 · 内部数据直连</div>
              <div className="plan-expire">2026-12-31 到期</div>
            </div>
            <button className="btn btn-outline-light" onClick={() => notify("续费流程即将上线（演示）")}>续费升级</button>
          </div>
        </div>
      </div>

      {editing === "risk" && (
        <ChoiceModal title="风险偏好" choices={riskChoices} selected={[risk]} notify={notify}
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
