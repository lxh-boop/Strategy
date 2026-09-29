/**
 * 因子取数冒烟脚本：不起 Nest 服务，直接实例化 MysqlFactorDataService 打真实库。
 *
 * 用法（在 factor-agent-server 目录下）：
 *   node scripts/smoke-db.js [表名] [字段1,字段2] [日期YYYYMMDD] [证券代码]
 *
 * 示例：
 *   node scripts/smoke-db.js                                          # 默认组合，验证 happy path
 *   node scripts/smoke-db.js equ_factor_cf "" 20210506 000002.XSHE    # 空 fields = SELECT *
 *   node scripts/smoke-db.js not_in_dict TotalFixedAssets 20210506 000002.XSHE   # 400 表不在字典
 *   node scripts/smoke-db.js equ_factor_derive NotAField 20210506 000002.XSHE    # 400 无此因子字段
 *   node scripts/smoke-db.js equ_factor_derive TotalFixedAssets 2021-05-06 000002.XSHE  # 400 日期格式
 *   node scripts/smoke-db.js equ_factor_derive TotalFixedAssets 20210506 000002    # 400 证券格式
 *
 * 前置：.env 里填好 MYSQL_USER / MYSQL_PASSWORD（happy path 需要，纯校验类用例不需要）。
 */
require('dotenv').config({ quiet: true });

const configuration = require('../dist/config/configuration').default;
const { MysqlFactorDataService } = require('../dist/core/implementations/mysql-factor-data.service');

const [table = 'equ_factor_derive', fieldsArg = 'TotalFixedAssets,IntFreeCL', date = '20210506', security = '000002.XSHE'] =
  process.argv.slice(2);
const fields = String(fieldsArg).split(',').map((s) => s.trim()).filter(Boolean);

// MysqlFactorDataService 只依赖 ConfigService.getOrThrow('mysql')，用最小替身注入真实配置
const configService = { getOrThrow: (key) => configuration()[key] };
const service = new MysqlFactorDataService(configService);

service
  .readTable({ table, fields, date, security })
  .then((rows) => {
    console.log(`OK  ${table} @ ${security} ${date}，字段[${fields.length ? fields.join(', ') : '全部'}]，${rows.length} 行:`);
    console.log(JSON.stringify(rows, null, 2));
  })
  .catch((error) => {
    const resp = typeof error.getResponse === 'function' ? error.getResponse() : null;
    if (resp) console.error(`FAIL [${error.getStatus()}] ${resp.code}: ${resp.message}`);
    else console.error('FAIL', error);
    process.exit(1);
  });
