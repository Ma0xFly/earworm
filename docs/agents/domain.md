# 领域文档（Domain Docs）

技能在探索代码库时，应当如何消费本仓库的领域文档。

## 探索之前先读这些

- 仓库根的 **`GLOSSARY.md`**；或
- 仓库根存在 **`GLOSSARY-MAP.md`** 时读它：它指向每个上下文各自的 `GLOSSARY.md`，挑与当前话题相关的读。
- **`docs/adr/`**：读与你要动的那块区域有关的 ADR。多上下文仓库里，还要看 `src/<context>/docs/adr/` 下该上下文专属的决定。

这些文件不存在就 **静默继续**。不要提示缺失，也不要一上来就建议建它们。等术语或决定真的被敲定了，`/domain-modeling` 技能（通过 `/grill-with-docs` 和 `/improve-codebase-architecture` 触达）会按需惰性创建。

## 文件结构

单上下文仓库（绝大多数仓库）：

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（判据：根目录存在 `GLOSSARY-MAP.md`）：

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← 系统级决定
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← 上下文专属决定
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## 使用术语表里的词

当你的产出要指名一个领域概念时（issue 标题、重构提案、假设、测试名），用 `GLOSSARY.md` 里的定义，不要漂移到术语表明确回避的同义词。

如果你需要的概念还不在术语表里，这是一个信号：要么你在发明项目并不使用的语言（重新想想），要么这是一个真实的空缺（记下来交给 `/domain-modeling`）。

## 撞到 ADR 要显式提出

如果你的产出与已有 ADR 冲突，明确指出来，不要悄悄覆盖：

> _与 ADR-0007（事件溯源订单）冲突，但值得重开，因为……_
