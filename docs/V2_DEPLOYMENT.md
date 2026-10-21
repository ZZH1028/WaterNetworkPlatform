# 澜枢 2.0 部署与验收说明

## 两种运行方式

新前端在 `web/`，原 Python/Streamlit 业务后台完整保留在 `app.py`。

```bash
python -m pip install 'pypdf>=5,<7'
python scripts/ingest_public_manuals.py
python scripts/build_web.py
python api/server.py
```

打开 http://127.0.0.1:8000 。`api/server.py` 同时提供静态前端和可选 RAG API。

原后台单独启动：

```bash
python -m pip install -r requirements.txt
streamlit run app.py
```

原后台所有 GIS 入口已改为 Cesium 实景三维，原二维统计图经统一样式函数转为三维时序或比较图。原权限、数据库、预测、调度、日志与备份服务保留。新增水利助手入口。

## GitHub Pages（只托管静态前端）

仓库 `ZZH1028/WaterNetworkPlatform` 的 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。

首次开通需要仓库管理员操作。普通 `GITHUB_TOKEN` 不能替代管理员为尚未启用的仓库开通 Pages，不能把提交代码等同于网站已经发布。

已启用 GitHub Actions 发布源。专业手册索引以已验证的压缩语料随仓库保存，构建无需重新下载手册；如需更新原文，可运行 `python scripts/ingest_public_manuals.py --refresh`，核验后重新生成压缩索引。

之后推送 `master` 自动运行 `.github/workflows/pages.yml`：测试 → 拉取官方技术手册 → 按页建索引 → 构建本地三维资源 → 发布。无需向浏览器暴露大模型密钥。若首次部署在 Pages 配置处失败，开通后重跑失败作业即可。

## 大模型服务

默认使用本地 BM25 风格知识检索，不假称大模型已经连接。

生产服务器设置：`HYDRO_LLM_BASE_URL`（兼容 Chat Completions 的 /v1 基础地址）、`HYDRO_LLM_MODEL`、`HYDRO_LLM_API_KEY`、`HYDRO_ACCESS_TOKEN`、`HYDRO_ALLOWED_ORIGINS`。密钥仅在服务端环境变量中设置；不要提交 `.env`。

公网运行须使用反向代理 HTTPS，并设置非空应用访问令牌：

```bash
python api/server.py --host 0.0.0.0 --port 8000
```

网页设置只填 API 地址和应用访问令牌；令牌仅当前标签页保存，不写进浏览器长期资料或导出备份。服务支持来源白名单、请求体限制、简单限流和引用 ID 校验。没有配置密钥或上游失败会明确回退本地检索。

## 资料来源与范围

- GIS：194 个站点、32 个闸站、110 条河道索引、305 个断面、19,317 个点。
- 河道索引是原项目断面中心连线；投影假定 EPSG:4528 待复核，不能作精确岸线。
- 断面保持原始本地平面坐标和吴淞高程；不直接与卫星地形高程混用。
- 三维实景为 Esri 在线卫星影像 + World Elevation 地形，工程为符号。精细倾斜摄影需提供授权 3D Tiles。
- 44 条中文编写知识与操作笔记，另按页索引 5 部官方技术手册：USACE HEC-RAS Hydraulic Reference、HEC-RAS 2D User Manual、NOAA Tidal Analysis、NOAA Tidal Datums、EPA SWMM 5.2 Manual。此次构建共 1,753 页、3,477 个原文片段。原文为英文，公式及表格请回 PDF 核查。
- USGS ADCP 手册下载遇 403，未纳入原文库；相关官方入口及中文测验笔记仍保留。目录的构建结果记录失败项，不能声称全量下载成功。
- 默认水位、阈值和推演是演示，未接入实时接口、训练模型或设备控制。真实观测可导入后覆盖演示显示。
- 浏览器资料不跨设备自动同步，需导出 / 恢复工作空间。

## 检查

```bash
python -m unittest discover -s tests -p test_rag_api.py -v
node --test tests/web.test.mjs
python -m compileall -q app.py ui api scripts
```

测试浏览器能验证路由、检索、引用、推演控制与设置；若其 WebGL 初始化不可用，三维视觉效果应记为尚未完成浏览器验证，不能用二维截图冒充已验证三维渲染。
