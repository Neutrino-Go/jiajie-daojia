const SERVICE_TYPES = ["日常保洁", "深度保洁", "开荒保洁", "家务整理"];
const DURATION_OPTIONS = [2, 3, 4, 5];
const RATING_OPTIONS = [1, 2, 3, 4, 5];
const COMMISSION_RATE = 0.05;
const COMMISSION_CAP = 30;
const DEEP_CLEANING_UNIT_PRICE = 8;
const POST_CONSTRUCTION_UNIT_PRICE = 13;

const SERVICE_PRICE = {
  日常保洁: 120,
  深度保洁: 180,
  开荒保洁: 260,
  家务整理: 150,
};

const DAILY_CLEANING_PRICE = {
  2: 99,
  3: 139,
  4: 179,
  5: 219,
};

const STATUS_LABELS = {
  pending: "等待家洁师响应",
  accepted: "待服务",
  waiting_response: "等待家洁师响应",
  waiting_confirm: "待确认",
  assigned_waiting_accept: "等待家洁师接受",
  assigned_declined: "家洁师已拒绝",
  waiting_payment: "待支付",
  confirmed: "待服务",
  in_service: "服务中",
  waiting_complete: "待验收",
  completed: "已完成",
  auto_completed: "已自动验收",
  cancelled: "已取消",
};

const STATUS_TIPS = {
  pending: "需求已发布，等待附近家洁师响应",
  accepted: "订单已确认，双方联系方式已开放",
  waiting_response: "需求已发布，等待附近家洁师响应",
  waiting_confirm: "已有家洁师响应，请选择合适的家洁师",
  assigned_waiting_accept: "已指定家洁师，等待对方接受",
  assigned_declined: "家洁师已拒绝，可重新指派或改为寻找家洁师",
  waiting_payment: "已选择家洁师，请先支付到平台托管",
  confirmed: "订单已确认，双方联系方式已开放",
  in_service: "服务正在进行",
  waiting_complete: "家洁师已提交完成，请确认服务结果",
  completed: "服务已完成，可评价",
  auto_completed: "超时未验收，系统已自动验收并完成结算",
  cancelled: "订单已取消",
};

const ROLE_LABELS = {
  customer: "住户端",
  cleaner: "家洁师端",
};

module.exports = {
  SERVICE_TYPES,
  DURATION_OPTIONS,
  RATING_OPTIONS,
  COMMISSION_RATE,
  COMMISSION_CAP,
  DEEP_CLEANING_UNIT_PRICE,
  POST_CONSTRUCTION_UNIT_PRICE,
  SERVICE_PRICE,
  DAILY_CLEANING_PRICE,
  STATUS_LABELS,
  STATUS_TIPS,
  ROLE_LABELS,
};
