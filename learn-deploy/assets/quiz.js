/* ============================================================
   learn-redis 共享 quiz 组件 — 零依赖 vanilla JS
   用法（lesson HTML 内）：
     <div class="quiz" data-quiz>
       <div class="quiz-q">
         <p class="quiz-prompt">问题…</p>
         <div class="quiz-opts">
           <button class="quiz-opt">选项 A</button>
           <button class="quiz-opt" data-correct>选项 B</button>
         </div>
         <div class="quiz-explain" data-when="wrong">答错时的解释</div>
         <div class="quiz-explain" data-when="right">答对时的解释</div>
       </div>
     </div>
   规则：每题首答计分；答错标红并提示、可继续重试；答对锁定并展示解释。
   ============================================================ */
(function () {
  "use strict";

  function buildQuiz(quizEl) {
    var questions = quizEl.querySelectorAll(".quiz-q");
    var total = questions.length;
    var seen = {};   // qi -> true（已首答）
    var firstTryHits = 0;

    var scoreEl = document.createElement("div");
    scoreEl.className = "quiz-score";
    quizEl.appendChild(scoreEl);

    function renderScore() {
      var done = quizEl.querySelectorAll(".quiz-opt.correct").length;
      scoreEl.innerHTML =
        "<span>首答正确 <strong>" + firstTryHits + "</strong> / " + total +
        "，已完成 " + done + " / " + total + "</span>";
      var resetBtn = document.createElement("button");
      resetBtn.className = "quiz-reset";
      resetBtn.textContent = "重做";
      resetBtn.addEventListener("click", resetQuiz);
      scoreEl.appendChild(resetBtn);
    }

    function resetQuiz() {
      firstTryHits = 0;
      seen = {};
      questions.forEach(function (q) {
        q.querySelectorAll(".quiz-opt").forEach(function (b) {
          b.disabled = false;
          b.classList.remove("correct", "wrong");
        });
        q.querySelectorAll(".quiz-explain").forEach(function (e) { e.classList.remove("show"); });
      });
      renderScore();
    }

    questions.forEach(function (q, qi) {
      var opts = q.querySelectorAll(".quiz-opt");
      var explainRight = q.querySelector('.quiz-explain[data-when="right"]');
      var explainWrong = q.querySelector('.quiz-explain[data-when="wrong"]');

      opts.forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (btn.disabled) return;
          var isCorrect = btn.hasAttribute("data-correct");

          if (isCorrect) {
            if (!seen[qi]) { seen[qi] = true; firstTryHits++; }
            opts.forEach(function (b) {
              b.disabled = true;
              if (b.hasAttribute("data-correct")) b.classList.add("correct");
            });
            if (explainWrong) explainWrong.classList.remove("show");
            if (explainRight) explainRight.classList.add("show");
          } else {
            if (!seen[qi]) { seen[qi] = true; } // 首答错了：不计入 hits，且不再补记
            btn.classList.add("wrong");
            btn.disabled = true;
            if (explainWrong) {
              if (!explainWrong.textContent.trim()) explainWrong.textContent = "不对——再想想，换一个选项。";
              explainWrong.classList.add("show");
            }
          }
          renderScore();
        });
      });
    });

    renderScore();
  }

  document.querySelectorAll("[data-quiz]").forEach(buildQuiz);
})();
