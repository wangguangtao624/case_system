# 运维长图生成记录

使用内置 imagegen 工具生成与校对，没有使用 CLI/API fallback。

- 最终交付：ops-workflow-long-v2.png。
- 初版：ops-workflow-long.png，仅保留用于复现编辑过程。
- 内容依据：12/38 实际部署、Windows 客户端与当前资源测量。
- 核心用途：用“用例变更历史”这一假设功能，解释开发、检查、预发布、受控发布和备份。

## 最终编辑提示词（原文）

Edit this existing Chinese long infographic with ONLY TWO text corrections for factual accuracy. Preserve the complete composition, all other text, colors, icons, arrows, layout, and long portrait aspect ratio. First, in the top three-machine section, replace the small gray arrow label “与开发环境物理隔离” with “独立服务器与数据”. We have verified separate servers, not their physical hardware placement; do not use the words 物理隔离 anywhere. Second, in section 5 pre-release acceptance, beneath the icon labeled “独立测试数据”, replace the text “不使用生产数据” with “使用隔离数据副本”. The actual pre-release uses an isolated copy restored from a production backup and never connects to the live production database. Keep all remaining visible text verbatim and sharply legible. Do not add labels or change any numbers. Produce one final corrected long infographic.
