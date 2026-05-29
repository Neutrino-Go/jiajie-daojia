const ORDER_STATUS = {
  WAITING_RESPONSE: "waiting_response",
  WAITING_CONFIRM: "waiting_confirm",
  ASSIGNED_WAITING_ACCEPT: "assigned_waiting_accept",
  ASSIGNED_DECLINED: "assigned_declined",
  WAITING_PAYMENT: "waiting_payment",
  CONFIRMED: "confirmed",
  IN_SERVICE: "in_service",
  WAITING_COMPLETE: "waiting_complete",
  COMPLETED: "completed",
  AUTO_COMPLETED: "auto_completed",
  CANCELLED: "cancelled",
};

const ORDER_STATUS_ALIASES = {
  accepted: ORDER_STATUS.CONFIRMED,
  waiting_acceptance: ORDER_STATUS.WAITING_COMPLETE,
  assigned_pending: ORDER_STATUS.ASSIGNED_WAITING_ACCEPT,
};

const UNKNOWN_STATUS_META = {
  title: "状态未知",
  desc: "订单状态暂未识别，请刷新后再试",
  badgeText: "状态未知",
};

const ORDER_STATUS_COPY = {
  customer: {
    [ORDER_STATUS.WAITING_RESPONSE]: {
      title: "等待家洁师响应",
      desc: "需求已发布，正在等待附近家洁师响应",
      badgeText: "待响应",
    },
    [ORDER_STATUS.WAITING_CONFIRM]: {
      title: "待确认",
      desc: "已有家洁师响应，请选择合适的家洁师",
      badgeText: "待确认",
    },
    [ORDER_STATUS.ASSIGNED_WAITING_ACCEPT]: {
      title: "等待家洁师接单",
      desc: "已指定家洁师，等待对方确认是否接单",
      badgeText: "待接单",
    },
    [ORDER_STATUS.ASSIGNED_DECLINED]: {
      title: "家洁师已拒绝",
      desc: "家洁师已拒绝，可重新指派或改为公开订单",
      badgeText: "已拒绝",
    },
    [ORDER_STATUS.WAITING_PAYMENT]: {
      title: "待支付",
      desc: "已选择家洁师，请完成支付后等待上门服务",
      badgeText: "待支付",
    },
    [ORDER_STATUS.CONFIRMED]: {
      title: "待服务",
      desc: "家洁师已确认，等待按约定时间上门服务",
      badgeText: "待服务",
    },
    [ORDER_STATUS.IN_SERVICE]: {
      title: "服务中",
      desc: "家洁师正在服务，请留意沟通消息",
      badgeText: "服务中",
    },
    [ORDER_STATUS.WAITING_COMPLETE]: {
      title: "待验收",
      desc: "家洁师已提交完成，请验收并评价本次服务",
      badgeText: "待验收",
    },
    [ORDER_STATUS.COMPLETED]: {
      title: "已完成",
      desc: "服务已完成，感谢你的使用",
      badgeText: "已完成",
    },
    [ORDER_STATUS.AUTO_COMPLETED]: {
      title: "系统已完成",
      desc: "超时未验收，系统已自动完成订单",
      badgeText: "已完成",
    },
    [ORDER_STATUS.CANCELLED]: {
      title: "已取消",
      desc: "订单已取消",
      badgeText: "已取消",
    },
  },
  cleaner: {
    [ORDER_STATUS.WAITING_RESPONSE]: {
      title: "可响应订单",
      desc: "客户需求已发布，可选择是否接单",
      badgeText: "可响应",
    },
    [ORDER_STATUS.WAITING_CONFIRM]: {
      title: "待客户确认",
      desc: "你已响应此订单，等待客户确认是否选择你",
      badgeText: "待客户确认",
    },
    [ORDER_STATUS.ASSIGNED_WAITING_ACCEPT]: {
      title: "待接单",
      desc: "客户已指定你服务，请确认是否接单",
      badgeText: "待接单",
    },
    [ORDER_STATUS.ASSIGNED_DECLINED]: {
      title: "已拒绝",
      desc: "你已拒绝该指派订单",
      badgeText: "已拒绝",
    },
    [ORDER_STATUS.WAITING_PAYMENT]: {
      title: "待客户支付",
      desc: "客户完成支付后，你即可按约定时间上门服务",
      badgeText: "待支付",
    },
    [ORDER_STATUS.CONFIRMED]: {
      title: "待服务",
      desc: "订单已确认，请按约定时间上门服务",
      badgeText: "待服务",
    },
    [ORDER_STATUS.IN_SERVICE]: {
      title: "服务中",
      desc: "订单服务进行中，完成后可提交服务完成",
      badgeText: "服务中",
    },
    [ORDER_STATUS.WAITING_COMPLETE]: {
      title: "待客户验收",
      desc: "你已提交完成，等待客户验收确认",
      badgeText: "待验收",
    },
    [ORDER_STATUS.COMPLETED]: {
      title: "已完成",
      desc: "客户已完成验收，订单已结束",
      badgeText: "已完成",
    },
    [ORDER_STATUS.AUTO_COMPLETED]: {
      title: "系统已完成",
      desc: "客户逾期未验收，系统已自动完成订单",
      badgeText: "已完成",
    },
    [ORDER_STATUS.CANCELLED]: {
      title: "已取消",
      desc: "订单已取消",
      badgeText: "已取消",
    },
  },
};

const ORDER_STATUS_GROUPS = {
  pending: [
    ORDER_STATUS.WAITING_RESPONSE,
    ORDER_STATUS.WAITING_CONFIRM,
    ORDER_STATUS.ASSIGNED_WAITING_ACCEPT,
    ORDER_STATUS.ASSIGNED_DECLINED,
  ],
  ongoing: [ORDER_STATUS.WAITING_PAYMENT, ORDER_STATUS.CONFIRMED, ORDER_STATUS.IN_SERVICE, ORDER_STATUS.WAITING_COMPLETE],
  completed: [ORDER_STATUS.COMPLETED, ORDER_STATUS.AUTO_COMPLETED],
  cancelled: [ORDER_STATUS.CANCELLED],
};

const TAB_COUNT_STATUSES = {
  customer: {
    pending: [ORDER_STATUS.WAITING_RESPONSE, ORDER_STATUS.WAITING_CONFIRM],
    ongoing: [ORDER_STATUS.WAITING_PAYMENT, ORDER_STATUS.CONFIRMED, ORDER_STATUS.IN_SERVICE, ORDER_STATUS.WAITING_COMPLETE],
  },
  cleaner: {
    pending: [ORDER_STATUS.WAITING_RESPONSE, ORDER_STATUS.WAITING_CONFIRM, ORDER_STATUS.ASSIGNED_WAITING_ACCEPT],
    ongoing: [ORDER_STATUS.WAITING_PAYMENT, ORDER_STATUS.CONFIRMED, ORDER_STATUS.IN_SERVICE, ORDER_STATUS.WAITING_COMPLETE],
  },
};

const TERMINAL_STATUSES = [ORDER_STATUS.COMPLETED, ORDER_STATUS.AUTO_COMPLETED, ORDER_STATUS.CANCELLED];
const CANCELABLE_STATUSES = [
  ORDER_STATUS.WAITING_RESPONSE,
  ORDER_STATUS.WAITING_CONFIRM,
  ORDER_STATUS.ASSIGNED_WAITING_ACCEPT,
  ORDER_STATUS.ASSIGNED_DECLINED,
  ORDER_STATUS.WAITING_PAYMENT,
  ORDER_STATUS.CONFIRMED,
];

function rawStatusOf(input) {
  if (input && typeof input === "object") return input.status || input.rawStatus || "";
  return input || "";
}

function publishModeOf(input, options = {}) {
  if (options.publishMode) return options.publishMode;
  if (input && typeof input === "object") return input.publishMode || "";
  return "";
}

function normalizeOrderStatus(input, options = {}) {
  const rawStatus = String(rawStatusOf(input) || "").trim();
  if (!rawStatus) return "";
  if (rawStatus === "pending") {
    return publishModeOf(input, options) === "assigned" ? ORDER_STATUS.ASSIGNED_WAITING_ACCEPT : ORDER_STATUS.WAITING_RESPONSE;
  }
  return ORDER_STATUS_ALIASES[rawStatus] || rawStatus;
}

function isKnownOrderStatus(status) {
  return Object.values(ORDER_STATUS).includes(status);
}

function getOrderStatusStyle(input) {
  const status = normalizeOrderStatus(input);
  if (status === ORDER_STATUS.COMPLETED || status === ORDER_STATUS.AUTO_COMPLETED) return "completed";
  if (status === ORDER_STATUS.CANCELLED) return "cancelled";
  if (status === ORDER_STATUS.IN_SERVICE || status === ORDER_STATUS.WAITING_COMPLETE) return "active";
  if (status === ORDER_STATUS.WAITING_PAYMENT) return "payment";
  if (status === ORDER_STATUS.CONFIRMED) return "accepted";
  return "waiting";
}

function getOrderStatusGroup(input) {
  const status = normalizeOrderStatus(input);
  for (const [group, statuses] of Object.entries(ORDER_STATUS_GROUPS)) {
    if (statuses.includes(status)) return group;
  }
  return "pending";
}

function isTerminalOrderStatus(input) {
  return TERMINAL_STATUSES.includes(normalizeOrderStatus(input));
}

function isCancelableOrderStatus(input) {
  return CANCELABLE_STATUSES.includes(normalizeOrderStatus(input));
}

function getOrderTabStatuses(tabKey, role = "customer") {
  const key = tabKey === "active" ? "ongoing" : tabKey;
  const map = TAB_COUNT_STATUSES[role] || TAB_COUNT_STATUSES.customer;
  return map[key] || [];
}

function getOrderStatusMeta(input, options = {}) {
  const role = options.role || options.viewerRole || "customer";
  const key = normalizeOrderStatus(input, options);
  const copyMap = ORDER_STATUS_COPY[role] || ORDER_STATUS_COPY.customer;
  const copy = key && isKnownOrderStatus(key) ? copyMap[key] || ORDER_STATUS_COPY.customer[key] : null;
  const statusCopy = copy || UNKNOWN_STATUS_META;
  const statusStyle = getOrderStatusStyle(key);
  return {
    key: key || "unknown",
    rawStatus: rawStatusOf(input),
    text: statusCopy.badgeText || statusCopy.title || UNKNOWN_STATUS_META.badgeText,
    title: statusCopy.title || UNKNOWN_STATUS_META.title,
    desc: statusCopy.desc || "",
    badgeText: statusCopy.badgeText || statusCopy.title || UNKNOWN_STATUS_META.badgeText,
    badgeClass: `order-main-status-${statusStyle}`,
    statusStyle,
    statusGroup: getOrderStatusGroup(key),
    isKnown: Boolean(key && isKnownOrderStatus(key)),
    isTerminal: isTerminalOrderStatus(key),
    isCancelable: isCancelableOrderStatus(key),
    roleSpecificText: statusCopy.title || UNKNOWN_STATUS_META.title,
  };
}

module.exports = {
  ORDER_STATUS,
  ORDER_STATUS_ALIASES,
  ORDER_STATUS_COPY,
  ORDER_STATUS_GROUPS,
  normalizeOrderStatus,
  getOrderStatusMeta,
  getOrderStatusStyle,
  getOrderStatusGroup,
  getOrderTabStatuses,
  isKnownOrderStatus,
  isTerminalOrderStatus,
  isCancelableOrderStatus,
};
