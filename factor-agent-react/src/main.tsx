import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installClientLogHooks } from "./api";
import "./styles/global.css";

// 前端日志出口：未捕获异常/Promise 拒绝 → POST /api/client-logs → logs/frontend/日期.log
installClientLogHooks();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
