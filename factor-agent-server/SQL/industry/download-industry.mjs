/* 行业/板块数据下载（Tushare Pro）：产出 CSV 到本目录。
 * 用法：TUSHARE_TOKEN=<你的token> node download-industry.mjs
 * token 只从环境变量读取，绝不写入本文件或产物。 */
const TOKEN = process.env.TUSHARE_TOKEN;
if (!TOKEN) { console.error("缺少 TUSHARE_TOKEN 环境变量"); process.exit(1); }
import { writeFileSync } from "node:fs";
import { join } from "node:path";

async function call(api, params) {
  const res = await fetch("https://api.tushare.pro", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_name: api, token: TOKEN, params: params || {} }),
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`${api} 失败: ${j.code} ${j.message}`);
  return { fields: j.data.fields, items: j.data.items, count: j.data.count ?? j.data.items.length };
}

function toCsv(fields, items) {
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return "\uFEFF" + [fields.join(","), ...items.map((r) => r.map(esc).join(","))].join("\r\n");
}

function save(name, { fields, items }) {
  const p = join(import.meta.dirname, name);
  writeFileSync(p, toCsv(fields, items));
  console.log(`✓ ${name}: ${items.length} 行`);
}

(async () => {
  // 1. 申万行业分类（2021 版，L1/L2/L3 全层级）
  save("sw2021_classify.csv", await call("index_classify", { src: "SW2021" }));

  // 2. 申万行业成分：在册 + 已调出（in_date/out_date 点位时间口径）
  const cur = await call("index_member_all", { is_new: "Y" });
  const hist = await call("index_member_all", { is_new: "N" });
  save("sw_member_current.csv", cur);
  save("sw_member_historical.csv", hist);

  // 3. 个股所属行业（Tushare 口径的简明行业字段）
  save("stock_industry.csv", await call("stock_basic", { list_status: "L" }, "ts_code,symbol,name,industry,market,list_date"));

  // 4. 东财板块（权限/参数不可用时跳过，不阻断其余产出）
  try {
    const dc = await call("dc_index", {});
    save("dc_board_index.csv", dc);
  } catch (e) {
    console.log(`- dc_index 跳过: ${e.message}`);
  }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
