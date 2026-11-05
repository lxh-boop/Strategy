# 术语墙：内核与运行时组件词汇需要"类别 + 一句话"定义

用户看不懂 0001 q02 的加分项（"overlay2（OverlayFS：lowerdir/upperdir/合并视图）……containerd image store……copy-up/whiteout"），直接问"OverlayFS 是什么，containerd image store 是什么"。根因在教师：一句话堆了六七个底层名词，没说明它们各属哪一类东西，违反了 LR-0005 的讲解纪律。已用"类别（内核功能 / 程序 / 模式 / 工具）+ 一句话 + 目录图 + 分工链"重讲，并按面试优先级分档。

Evidence: 2026-11-02 用户原话："这些都没看懂，OverlayFS是什么，containerd image store是什么"。
Implications:
- 课件里的"加分项"同样受 LR-0005 约束：出现底层名词，先给类别和一句话定义，再写细节；一段写不下就拆成单独的进阶题（本次拆出 q24）。
- 底层知识点标明面试优先级（必须会 / 认识名字 / 知道有就行），这位学习者需要知道哪些可以只认识名字。
- 用户的词汇边界：Linux 内核与容器运行时层（文件系统、驱动、运行时组件）不在词汇表里；涉及时从"硬盘上就是普通目录""后台程序"这类可落地的描述起步。
- 待验证：能否口述"Docker 分层靠 OverlayFS：叠目录 + copy-up + whiteout"——下次作为检索题。
