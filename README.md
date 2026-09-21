# CRC 参数反演复核台

纯浏览器（React + TypeScript）**CRC 候选配置族反演 / 复核台**。工程师在页面中
导入或编辑「样本（十六进制载荷 + 观测校验值）」与「候选配置族（编号、8/16 位宽度、
移位方向、多项式；**init 与 xorOut 未知**）」，启动反演，检查每个候选的判定与
参数见证，并可逐样本展开**逐位寄存器轨迹**核对中间寄存器和最终校验值。

计算全部在本机浏览器（Web Worker）完成，**不调用任何业务后端**；容器中的 nginx
只负责托管静态文件与健康检查。

---

## 为什么不是"凑参数"

逐个试 init/xorOut 有 2^16（8 位）或 2^32（16 位）组合，且偶然吻合的组合并不唯一：

- **样本不足**时自由位 > 0，存在多组 (init, xorOut) 同时满足全部样本；
- 即使样本充分，**结构歧义仍可能无法消除**：当生成多项式含 `x+1` 因子
  （等价于裸多项式按位置异或为 1 / popcount 为奇数，如 CRC-8 的 `0x07`、
  CRC-16 的 `0x1021` / 反射 `0xA001`）时，存在非零 `d` 使
  `final(init⊕d, msg) ≡ final(init, msg) ⊕ d` 对**任意载荷**成立，于是
  `(init, xorOut)` 与 `(init⊕d, xorOut⊕d)` 在观测上永远不可区分。

本工具把 CRC 末态写成 init 的仿射 GF(2) 映射，通过**高斯–若尔当消元**求约束系统的
秩与零化度，**精确统计全部解（解数 = 2^零化度），绝不枚举 init/xorOut**，并区分
**无解 / 唯一 / 歧义**。

## 反演原理

对给定候选（宽 `w`、方向、poly），载荷喂完后的寄存器是 init 的仿射线性函数：

```
final_s = M_s · init ⊕ c_s        // M_s 由 w+1 次逐位递推差分得到，不枚举 init
```

每条样本的观测给出关于 2w 个未知位（init、xorOut 各 w 位）的 w 行 GF(2) 方程：

```
M_s · init ⊕ xorOut = obs_s ⊕ c_s
```

对全部方程做 RREF：

| 结果 | 判据 | 含义 |
| --- | --- | --- |
| 无解 | 消元后出现 `0 = 1` 矛盾行 | 无任何 (init, xorOut) 同时满足全部样本 |
| 唯一 | 一致且零化度 0 | 唯一 (init, xorOut) |
| 歧义 | 一致且零化度 d > 0 | 恰有 **2^d** 组解 |

见证：主元按字典序显著性（init 高位→低位，再 xorOut 高位→低位）选取，用零空间基
对特解做按主元位消歧的贪心最小化，得到**字典序最小见证**；歧义时附**第二小见证**。

### 逐位递推约定

```
左移（MSB-first）：mixed = reg 最高位 ⊕ inBit； reg = (reg << 1) ⊕ (mixed ? poly : 0)
右移（LSB-first）：mixed = reg 最低位 ⊕ inBit； reg = (reg >> 1) ⊕ (mixed ? poly : 0)
最终校验值 = 末态寄存器 ⊕ xorOut
```

## 页面能力

- 样本 3–64 条（十六进制载荷，空格/冒号/`0x` 分隔均可）+ 观测值（十进制或 `0x..`）；
- 候选 1–128 个，每项唯一编号、宽度 8/16、方向 left/right、裸多项式；
- 导入 / 导出 / 剪贴板导入 JSON；内置唯一、歧义、多候选三个示例；
- Web Worker 反演，可**随时取消**；进度条；
- 每个候选展示：判定徽章、**精确解数（=2^零化度）**、秩、零化度、最小见证、
  歧义时第二见证；
- **逐样本核对**：展开任意样本查看逐拍（输入位、混合位、移位后值、是否异或多项式、
  拍后寄存器）以及 init → 字节边界寄存器 → finalReg ⊕ xorOut = 校验值的完整链条，
  并逐条比对观测值（最小见证与第二见证均可切换查看）；
- **非法输入阻止计算**（全部问题定位列出）；**取消计算、再次编辑均清空旧结论**，
  不会展示过期或部分结果。

## 模型 JSON 格式

```json
{
  "name": "设备A固件2.3",
  "samples": [
    { "payloadHex": "01 03 00 00 00 0A", "observed": 12 },
    { "payloadHex": "01 04 02 FF FF", "observed": "0xBB" }
  ],
  "candidates": [
    { "id": "CRC8-1D-L", "width": 8, "direction": "left", "poly": "0x1D" }
  ]
}
```

`observed` / `poly` 可写数字或 `"0x.."` 字符串。观测值需在候选宽度范围内。

## 本地开发

```bash
npm ci
npm run dev          # http://localhost:5173
npm test             # 38 项测试：标准 CRC 向量、GF(2) 审计 vs 全枚举 oracle（8 位全空间、
                     #            16 位独立 init 枚举）、校验、取消、UI 冒烟
npm run build        # 类型检查 + 生产构建到 dist/
npm run verify       # 一次性验收：类型检查→测试→构建→静态站点/健康检查/资源探活
```

## Docker

静态 Web（nginx，监听容器 8080，`/healthz` 返回 `ok`，带容器健康检查）：

```bash
# 宿主机端口可配置（默认 8080）
WEB_PORT=9090 docker compose up --build web
# 浏览器打开 http://localhost:9090
```

**一次性验收服务 `verify`**：完成后自行退出，并以退出码报告结果（0 通过 / 非 0 失败）：

```bash
docker compose up --build verify          # 会等待 web 健康后探活，结束退出
# 或
docker compose run --rm verify; echo "exit=$?"
```

## 目录

```
src/lib/       领域模型、十六进制解析、CRC 逐位递推、GF(2) RREF 审计、编排、导入导出
src/workers/   反演 Web Worker（可取消）
src/ui/        React 页面（编辑表、反演控制、判定与见证、逐位轨迹核对）
test/          标准向量 + 与枚举 oracle 的性质交叉验证 + UI 冒烟
scripts/       verify.mjs（验收）、gen-examples.ts（示例生成）
examples/      自洽示例模型 JSON
Dockerfile     deps / builder(verify) / web 多阶段
```

## 关键正确性证据

- 标准 CRC 向量：CRC-8 (`"123456789" → F4`)、MODBUS (`→ 4B37`)、CCITT-FALSE (`→ 29B1`)、
  KERMIT (`→ 2189`)、XMODEM (`→ 31C3`) 均通过；
- 8 位候选：审计计数 / 最小见证 / 第二见证在多组随机实例上与 **65536 组全枚举**
  逐一吻合；
- 16 位候选：与绕开 GF(2) 的**独立 65536 init 枚举 oracle**（xorOut 由首样本解出）
  逐一吻合；
- 含 `x+1` 因子多项式的**结构歧义**（样本无限多也只剩 2 组解）有专项回归；
- 无解（翻转观测位）、歧义（短样本）、唯一（充分样本）三种判定均有覆盖。
