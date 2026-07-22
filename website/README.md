# PaCode 官网

静态落地页，部署到 GitHub Pages。

## 本地预览

```bash
npx --yes serve website
# 或 python3 -m http.server 8080 --directory website
```

## 发布

仓库已配置 `.github/workflows/pages.yml`：推送到 `main` 后自动发布 `website/`。

也可在仓库 Settings → Pages → Source 选 **GitHub Actions**。

线上地址（启用 Pages 后）：

https://yhtyhj-hue.github.io/PaCode/
