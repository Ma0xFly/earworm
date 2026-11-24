# Issue tracker：GitHub

本仓库的 issue 与 spec 都作为 GitHub issue 存在。所有操作走 `gh` CLI。

## 约定

- **建 issue**：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- **读 issue**：`gh issue view <number> --json number,title,body,labels,comments`。
- **列 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需加 `--label` 和 `--state` 过滤。
- **把 issue 变成某父 issue 的子 issue**：`gh issue create --parent <parent> ...`，或者事后 `gh issue edit <parent> --add-sub-issue <child>`（`gh` 2.94+）。老版本 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`（用 database id，见下面 **阻塞关系**）。如果环境没有 sub-issue 能力，就在子 issue 正文顶部写 `Part of #<parent>`。
- **阻塞关系**：用 GitHub 原生的 **issue dependencies**，这是唯一在 UI 里可见的规范表示。加边用 `gh issue create --blocked-by <n>,<n> ...` 或 `gh issue edit <child> --add-blocked-by <blocker>`（`gh` 2.94+）。老版本 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞方的数字 **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，_不是_ `#number` 也不是 `node_id`）。环境不支持 dependencies 时退化：在子 issue 正文顶部写 `Blocked by: #<n>, #<n>`。所有阻塞方都关闭，票才算解除阻塞。
- **数还开着的阻塞方**：`gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by`（只数 OPEN 的；0 表示可以开工）。`gh issue view <n> --json blockedBy` 会把已关闭的也算进来，所以要么加上过滤：`--jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`。
- **评论**：`gh issue comment <number> --body "..."`。
- **加/去标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`。
- **关闭**：先用 `gh issue comment <number> --body "..."` 写清原因，再 `gh issue close <number>`。注意对已经关闭的 issue 执行 `gh issue close --comment` 会丢掉评论但仍返回 0，别拿退出码当成功判据。

仓库从 `git remote -v` 推断；在克隆目录里跑 `gh` 会自动推断。

issue 只能提到用户自己的仓库里。除非用户本人拥有 `mattpocock/skills`，否则绝不往那里提。在 fork 里 `gh` 可能默认指向 upstream 父仓库，所以每次会话第一次 `gh issue create` 之前，先 `gh repo view --json nameWithOwner` 核一下目标，不是本人仓库就跟用户确认。

## PR 作为 triage 面

**PR 作为请求入口：否。**（若本仓库把外部 PR 当作 feature request 处理，改成 `yes`；`/triage` 会读这个开关。）

设成 `yes` 时，PR 走与 issue 相同的标签和状态，命令换成 `gh pr` 等价物：

- **读 PR**：`gh pr view <number>`，然后 `gh pr view <number> --comments`（非 TTY 下 `--comments` 只打印评论、不含正文），diff 用 `gh pr diff <number>`。
- **列待 triage 的外部 PR**：`gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`。
- **评论 / 标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 与 PR 共用一个编号空间，所以裸写的 `#42` 可能指向任何一个：先用 `gh pr view 42` 解析，失败再退到 `gh issue view 42`。

## 技能说“发布到 issue tracker”时

建一个 GitHub issue。

## 技能说“取出相关 ticket”时

按上面 **读 issue** 的方式读。

## Wayfinding 操作

供 `/wayfinder` 使用。**地图（map）** 是一个 issue，**子票** 是它的子 issue。

- **地图**：单个带 `wayfinder:map` 标签的 issue，正文承载 Notes / 到目前的决定 / Fog。`gh issue create --label wayfinder:map`。
- **子票**：作为 GitHub sub-issue 挂到地图下（见 **把 issue 变成某父 issue 的子 issue**）。sub-issue 不可用时，把子票加进地图正文的 task list，并在子票正文顶部写 `Part of #<map>`。标签：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。认领后把票指派给推进的开发者。
- **阻塞**：见约定里的 **阻塞关系**。
- **前沿查询（frontier）**：列出地图下处于 OPEN 的子票（`gh issue list --state open`，范围限定该地图的 sub-issue / task list），剔除已有 OPEN 阻塞方（见 **数还开着的阻塞方**，或正文 `Blocked by` 行里引用了 OPEN issue 的）以及已有 assignee 的；按地图顺序取第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`，这是本次会话的第一次写操作。
- **解决**：`gh issue comment <n> --body "<answer>"`，然后 `gh issue close <n>`，最后往地图的“到目前的决定”里追加一条上下文指针（要点 + 链接）。
