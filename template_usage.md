# 数据表说明

> 水网工程水力调控智能平台 V1.0 — 成员2 交付
> 更新日期：2026-08-01

## 表结构总览（13 张表）

### 1. users — 用户表
| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| username | VARCHAR(64) | UNIQUE, INDEX | 用户名 |
| password_hash | VARCHAR(256) | NOT NULL | PBKDF2-SHA256 密码哈希 |
| role | VARCHAR(32) | DEFAULT "查看用户" | 角色：管理员/科研人员/调度人员/查看用户 |
| enabled | BOOLEAN | DEFAULT TRUE | 启用状态，FALSE=禁用/软删除 |
| last_login_at | DATETIME | NULLABLE | 最后登录时间 |
| created_at | DATETIME | NOT NULL | 创建时间 |
| updated_at | DATETIME | NOT NULL | 更新时间 |

### 2. monitoring_stations — 监测站信息
| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| station_id | VARCHAR(64) | UNIQUE, INDEX | 站点唯一编号 |
| station_name | VARCHAR(128) | NOT NULL | 站点名称 |
| longitude | FLOAT | NOT NULL | 经度 [-180, 180] |
| latitude | FLOAT | NOT NULL | 纬度 [-90, 90] |
| station_type | VARCHAR(32) | NOT NULL | 站点类型（水位站/雨量站等） |
| warning_level | FLOAT | NULLABLE | 警戒水位 |
| data_source | VARCHAR(128) | DEFAULT "manual" | 数据来源 |
| created_at / updated_at | DATETIME | NOT NULL | 时间戳 |

### 3. river_reaches — 河道信息
| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| reach_id | VARCHAR(64) | UNIQUE | 河道唯一编号 |
| reach_name | VARCHAR(128) | NOT NULL | 河道名称 |
| start_node / end_node | VARCHAR(64) | NULLABLE | 起止节点 |
| length_km | FLOAT | NULLABLE | 长度（km） |
| roughness | FLOAT | NULLABLE | 糙率系数 |
| data_source | VARCHAR(128) | DEFAULT "manual" | 数据来源 |

### 4. gates — 闸门信息
| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| gate_id | VARCHAR(64) | UNIQUE | 闸门唯一编号 |
| gate_name | VARCHAR(128) | NOT NULL | 闸门名称 |
| longitude / latitude | FLOAT | NOT NULL | 坐标 |
| max_opening | FLOAT | DEFAULT 100 | 最大开度 |
| current_opening | FLOAT | DEFAULT 0 | 当前开度 |
| status | VARCHAR(32) | DEFAULT "正常" | 状态 |

### 5. pump_stations — 泵站信息
| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| pump_id | VARCHAR(64) | UNIQUE | 泵站唯一编号 |
| pump_name | VARCHAR(128) | NOT NULL | 泵站名称 |
| longitude / latitude | FLOAT | NOT NULL | 坐标 |
| design_flow | FLOAT | NULLABLE | 设计流量 |
| current_flow | FLOAT | DEFAULT 0 | 当前流量 |
| running | BOOLEAN | DEFAULT FALSE | 运行状态 |
| status | VARCHAR(32) | DEFAULT "正常" | 状态 |

### 6-9. 时序监测数据
| 表名 | 唯一约束 | 值字段 |
|------|----------|--------|
| water_level_data | UNIQUE(station_id, monitor_time) | water_level (FLOAT) |
| flow_data | UNIQUE(station_id, monitor_time) | flow_value (FLOAT) |
| rainfall_data | UNIQUE(station_id, monitor_time) | rainfall (FLOAT) |
| tide_data | UNIQUE(station_id, monitor_time) | tide_level (FLOAT) |

共同字段：id (PK), station_id (INDEX), monitor_time (INDEX), data_source, quality_flag (水位/流量), created_at, updated_at

### 10. alerts — 预警记录
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| alert_code | VARCHAR(64) UNIQUE | 预警编号 |
| station_id | VARCHAR(64) INDEX | 关联站点 |
| alert_time | DATETIME | 预警触发时间 |
| alert_type | VARCHAR(64) | 预警类型 |
| alert_level | VARCHAR(16) | 红/橙/黄/蓝 |
| message | TEXT | 预警信息 |
| alert_status | VARCHAR(32) DEFAULT "待确认" | 状态 |
| handled_by | VARCHAR(64) NULLABLE | 处理人 |
| handled_at | DATETIME NULLABLE | **处理时间（Phase 1 新增）** |

### 11. operation_logs — 操作日志
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| operation_time | DATETIME | 操作时间 |
| username | VARCHAR(64) NULLABLE | 操作用户 |
| action | VARCHAR(128) | 操作描述 |
| log_type | VARCHAR(32) NULLABLE | **日志分类（Phase 1 新增）**：user/import/export/delete/alert/backup |
| result | VARCHAR(32) DEFAULT "成功" | 操作结果 |
| details | TEXT NULLABLE | 详情 |
| client_ip | VARCHAR(64) NULLABLE | 客户端 IP |

### 12. prediction_tasks / prediction_results
预测任务与结果（成员1/4 负责，此处不展开）。

### 13. scheduling_plans
调度方案（成员1/4 负责，此处不展开）。

### 14. model_registry
模型注册表（成员4 负责，此处不展开）。

### 15. uploaded_files — 上传文件记录
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | |
| stored_name | VARCHAR(256) UNIQUE | 存储文件名 |
| original_name | VARCHAR(256) | 原始文件名 |
| dataset_type | VARCHAR(64) | 数据类型 |
| uploaded_by | VARCHAR(64) | 上传用户 |
| file_size | INTEGER | 文件大小 |
| import_status | VARCHAR(32) | 导入状态 |
| imported_rows / failed_rows | INTEGER | 导入统计 |

## ER 关系

```
users ──────────────────────────────────────────┐
                                                 │
monitoring_stations ──→ water_level_data        │
                    ──→ flow_data               │
                    ──→ rainfall_data           │
                    ──→ tide_data               │
                    ──→ alerts                  │
                                                 │
river_reaches (独立)                             │
gates (独立)                                     │
pump_stations (独立)                             │
                                                 │
operation_logs ←── 所有操作记录                   │
uploaded_files ←── 文件上传记录                   │
```

## 索引
- users: username (UNIQUE)
- monitoring_stations: station_id (UNIQUE)
- river_reaches: reach_id (UNIQUE)
- gates: gate_id (UNIQUE)
- pump_stations: pump_id (UNIQUE)
- 时序数据: (station_id, monitor_time) UNIQUE
- alerts: alert_code (UNIQUE), station_id
- prediction_tasks: task_code (UNIQUE)
- scheduling_plans: batch_code
