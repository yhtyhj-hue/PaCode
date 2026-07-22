# PaCode 官网

静态落地页，部署到 GitHub Pages。

## 本地预览

```bash
npx --yes serve website
# 或 python3 -m http.server 8080 --directory website
```

## 内容结构

- Hero / 优势 / **模型对照（vs OpenCode）** / M5 实测 / 三方对比 / **版本更新** / 安装
- 文案与仓库 `CHANGELOG.md`、`docs/CONFIG.md` 保持一致；推 `main` 后 Pages 自动更新

仓库已配置 `.github/workflows/pages.yml`：推送到 `main` 后自动发布 `website/`。

也可在仓库 Settings → Pages → Source 选 **GitHub Actions**。

线上地址（启用 Pages 后）：

https://yhtyhj-hue.github.io/PaCode/
