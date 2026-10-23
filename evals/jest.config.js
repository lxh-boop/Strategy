/** evals 测评跑批配置：jest 仅作 TS 执行器——跑批是测量不是门禁，成败不看 jest 断言 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  // 注意：不映射 @langchain/* 到 server 的 node_modules——mapper 指向包根会绕过 package.json
  // exports 拿到 ESM shim 直接炸。evals 自装同名依赖（双副本），边界安全的前提：
  // server 侧对象（BaseMessage 等）从不由 evals 构造再传入 server（录制代理只透传，
  // ApiException 从 server 文件导入保证 instanceof 同源，judge 是自包含子树）。见 README 工程约束。
  // 跑批是长任务（k 次重复 × 数十任务 × 真实 GLM 轮次），给足上限
  testTimeout: 4 * 60 * 60 * 1000,
};
