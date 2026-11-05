# Steelfront（原型）

原创 WWII 风格 3D 载具对战原型。TypeScript + Vite + three.js + Rapier，单机运行。
所有名称、模型与数据均为原创；第三方资源仅限 CC0 / MIT，登记于 `public/assets/LICENSES.md`。

## 运行

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest 单元测试
npm run typecheck  # tsc --noEmit
npm run build      # 类型检查 + 生产构建
```

## 操作

| 按键 | 功能 |
|---|---|
| 点击画面 | 锁定鼠标 |
| W / S | 前进 / 倒车 |
| A / D | 转向（静止时原地转向） |
| 鼠标 | 视角 / 瞄准，炮塔按限速跟随 |
| 左键 | 开火 |
| 1 / 2 | 选择弹种（AP / HE） |
| R | 对局结束后重新开始 |
| 右键按住 | 炮镜视角 |
| 滚轮 | 第三人称视距 / 炮镜倍率 |

## 进度

- [x] M0 脚手架：固定步长主循环（60Hz）+ 渲染插值、轻量 ECS、数据加载与校验
- [x] M1 程序化地形（1024 m × 1024 m）、障碍物、AI 掩体点
- [x] M2 履带机动（悬挂射线 + 差速转向）、炮塔/火炮限速与限位、第三人称 / 炮镜
- [x] M3 弹道与弹种：RK4 弹道 + 二次阻力、射线扫掠命中、AP/HE、装填与换弹、散布、后坐力
- [x] M4 装甲与伤害模型：凸多面体分区装甲、t/cosθ 等效厚度、跳弹/过压、车内弹体+破片+装药爆炸、模块与乘员失效、殉爆、击毁判定
- [x] M5 AI 对手：视线+识别时间感知、听声辨位、网格 A* 寻路、掩体选择与探头射击、弹道/提前量解算+人为误差、队友分散
- [ ] M6 HUD

## 架构要点

- **模拟与渲染分离**：`src/game/Simulation.ts` 不依赖 three.js 或 DOM，可在 Node 中运行（见 `MobilitySystem.test.ts`）。
  渲染层只读取 ECS 状态，并在相邻两个 tick 之间插值。
- **统一控制意图**：玩家、AI 和未来的网络端都只写 `ControlIntent`。
- **物理抽象**：玩法代码只依赖 `src/physics/PhysicsWorld.ts` 接口，Rapier 实现位于 `RapierWorld.ts`。
- **坐标约定**：模拟使用 +X 右、+Y 上、-Z 前；`data/*.json` 使用设计坐标（+Z 前），加载时统一转换。
- **数据驱动**：载具、弹种、地图、AI 难度均位于 `data/`，由 zod 校验并做交叉引用检查。
  对局配置（敌方数量、载具、AI 难度）写在地图 JSON 的 `match` 字段中。

## AI 对手

AI 与玩家使用同一个 `ControlIntent`，遵循完全相同的物理、装甲与火控规则，没有任何"作弊"能力。

| 模块 | 内容 |
|---|---|
| `src/ai/perception.ts` | 车长观察点到目标 5 个采样点的视线检测；按距离计算识别时间，部分暴露（车体隐蔽）识别更慢 |
| `src/ai/gunnery.ts` | 迭代求解射角与提前量（含空气阻力）；瞄准误差随瞄准时间收敛、随目标/自身运动增大、随连续射击（修正弹着）减小；测距与测速误差 |
| `src/ai/navGrid.ts` | 4 m 网格 A*：障碍按车宽膨胀、陡坡与地图边缘不可通行，路径做拉直平滑 |
| `src/ai/cover.ts` | 掩体评分：车体须对威胁隐蔽；优先车体隐蔽位，否则规划绕过障碍边缘的探头射击位 |
| `src/systems/AISystem.ts` | 状态机：巡逻 → 进入掩体 → 掩体内装填/预瞄 → 探头射击 → 倒车回掩体；无掩体时原地侧转车体迎敌。听到炮声或中弹会获得射手大致位置；队友之间预约掩体以分散 |

难度档位：`data/ai/novice.json`、`regular.json`、`veteran.json`。
