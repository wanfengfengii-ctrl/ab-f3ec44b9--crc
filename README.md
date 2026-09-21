# CRC 参数反演复核台

纯前端（React + TypeScript + Vite）的 CRC 候选配置复核工具。工程师在浏览器中
导入/编辑采集样本与候选配置族，启动反演并逐样本核对参数见证。**全程不调用任何
业务后端**：所有数据与计算都停留在本机浏览器，发布物为纯静态文件。

## 解决的问题

更换固件后只留下若干载荷与观测校验值。逐个试候选配置时，**偶然吻合**的 CRC 参数
（观测方程秩亏）常被误当成唯一协议。本工具不做“试出一个能算对的值就停止”，而是：

1. 对每个候选（宽度 8/16、移位方向、多项式已知；`init` 与 `xorOut` 未知）建立
   GF(2) 线性约束并**精确统计全部解**；
2. 明确区分 **无解 / 唯一 / 歧义**，歧义时给出解的总数（2^零空间维数）、
   字典序最小见证及第二份见证；
3. 支持逐样本、逐位核对中间寄存器与最终校验值。

## 数学方法（不枚举 init/xorOut）

逐位递推关于 `init` 是 GF(2) 仿射映射：`register = M·init ⊕ d`，其中 `M` 的列随
逐拍转移同步演化即可得到。叠加 `xorOut` 后，每个样本给出 `w` 个线性方程：

```
M_i · init ⊕ xorOut = observed_i ⊕ d_i
```

全部样本堆叠为至多 `64·16 = 1024` 行、`2w ≤ 32` 个未知量的 GF(2) 方程组，
高斯-若当消元判定：

- 出现 `0 = 1` → **无解**；
- 零空间维数 `d = 0` → **唯一**，解数恰为 1；
- 否则 **歧义**，解数恰为 `2^d`（bigint 精确表示，不枚举）。

见证取法：未知量按“高 w 位 init、低 w 位 xorOut”排布，数值序即 `(init, xorOut)`
字典序；零空间基约化为主元互斥形后贪心翻转得到最小见证，再异或最低主元基向量
得到第二小见证。

> 可辨识性提示：逐位转移矩阵 `T` 与载荷内容无关，`M = T^(8·字节数)` 只取决于
> 载荷**长度**；若多项式系数重量为偶数（含 x+1 因子，如 CRC-8 的 0x07），
> `I+T` 恒奇异，`(init, xorOut)` 在任意样本下都至少有两组解。这类候选会被
> 如实标记为歧义，而不是误报唯一。

## 输入规模与合法性

- 每份模型 3～64 条样本（十六进制载荷 + 观测值，编号唯一）；
- 至多 128 个候选，每项含唯一编号、宽度（8 或 16）、移位方向
  （`msb-first` 左移 / `lsb-first` 右移）、多项式（hex）；
- 非法输入（编号重复/缺失、非十六进制、字节未对齐、多项式或观测值超宽、
  数量越界等）在反演前拦截；**非法输入或取消计算都会立即清空旧结论**。

## 本地开发

```bash
npm ci
npm run dev        # 本地开发
npm run build      # 类型检查 + 静态产物到 dist/
npm run acceptance # 一次性验收（数学性质；设 BASE_URL 时附加 HTTP 验收）
```

## Docker

镜像为多阶段构建：`web`（nginx 承载静态站点，含 `/healthz` 与容器 HEALTHCHECK）、
`verify`（一次性验收服务）。

```bash
# 宿主机端口可配置（默认 8080）
WEB_PORT=9090 docker compose up -d web
# 打开 http://localhost:9090

# 一次性验收：等待 web 健康后运行，自行退出，退出码报告结果
docker compose build
docker compose up --exit-code-from verify verify
echo "verify exit code: $?"
```

verify 容器内验收包含：公开 CRC 目录参考值（CRC-8 check=F4、
CRC-16/KERMIT check=2189）、无解/唯一/歧义三类判定、精确解数与字典序
最小/次小见证（与验收夹具内的小规模暴力枚举交叉验证）、非法输入拦截，
以及对 `http://web/`、`http://web/healthz` 与打包资源的 HTTP 检查。

## 模型 JSON 格式

见 [`examples/model.example.json`](examples/model.example.json)，可在页面直接导入。

```json
{
  "name": "采集批次",
  "samples": [
    { "id": "S1", "payload": "01 03 00 2A", "observed": "51" }
  ],
  "candidates": [
    { "id": "C8-1D", "width": 8, "direction": "msb-first", "poly": "1D" }
  ]
}
```
