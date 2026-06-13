function normalizeEdge(edge = {}) {
  return {
    sourceType: edge.sourceType || "user",
    sourceId: String(edge.sourceId || edge.userOpenid || edge.customerOpenid || "").trim(),
    targetType: edge.targetType || "cleaner",
    targetId: String(edge.targetId || edge.cleanerOpenid || edge.cleanerId || "").trim(),
    edgeType: String(edge.edgeType || "interaction").trim(),
    orderId: String(edge.orderId || "").trim(),
    claimId: String(edge.claimId || "").trim(),
    weight: Math.max(1, Number(edge.weight || 1)),
    occurredAt: edge.occurredAt || new Date().toISOString(),
    metadata: edge.metadata || {},
  };
}

function edgeKey(edge = {}) {
  return [
    edge.sourceType || "user",
    edge.sourceId || "",
    edge.targetType || "cleaner",
    edge.targetId || "",
    edge.edgeType || "interaction",
  ].join("::");
}

function filterEdges(edges = [], query = {}) {
  return edges.filter((edge) => {
    if (query.sourceId && edge.sourceId !== query.sourceId) return false;
    if (query.targetId && edge.targetId !== query.targetId) return false;
    if (query.orderId && edge.orderId !== query.orderId) return false;
    if (query.claimId && edge.claimId !== query.claimId) return false;
    return true;
  });
}

function createMemoryBehaviorGraphStore(initialEdges = []) {
  const records = initialEdges.map((edge) => ({ _id: edge._id || edgeKey(normalizeEdge(edge)), ...normalizeEdge(edge) }));
  return {
    addEdge(edge) {
      const normalized = normalizeEdge(edge);
      const key = edgeKey(normalized);
      const existing = records.find((item) => edgeKey(item) === key && item.orderId === normalized.orderId && item.claimId === normalized.claimId);
      if (existing) {
        existing.weight += normalized.weight;
        existing.updatedAt = normalized.occurredAt;
        return existing;
      }
      const next = { _id: `${key}::${records.length + 1}`, ...normalized, createdAt: normalized.occurredAt, updatedAt: normalized.occurredAt };
      records.push(next);
      return next;
    },
    updateWeight(edge) {
      const normalized = normalizeEdge(edge);
      const key = edgeKey(normalized);
      let existing = records.find((item) => edgeKey(item) === key);
      if (!existing) {
        existing = { _id: `${key}::${records.length + 1}`, ...normalized, weight: 0, createdAt: normalized.occurredAt };
        records.push(existing);
      }
      existing.weight = Math.max(0, Number(existing.weight || 0) + Number(edge.delta || normalized.weight || 1));
      existing.updatedAt = normalized.occurredAt;
      return existing;
    },
    getGraph(query = {}) {
      const edges = filterEdges(records, query).map((edge) => ({ ...edge }));
      return {
        edges,
        sourceId: query.sourceId || "",
        targetId: query.targetId || "",
        edgeCount: edges.length,
        totalWeight: edges.reduce((sum, edge) => sum + Number(edge.weight || 0), 0),
      };
    },
    records,
  };
}

function createBehaviorGraphStore(db, options = {}) {
  const collectionName = options.collectionName || "behaviorGraphEdges";
  const now = options.now || (() => new Date());
  return {
    async addEdge(edge) {
      const normalized = normalizeEdge({ ...edge, occurredAt: edge.occurredAt || now().toISOString() });
      const result = await db.collection(collectionName).add({
        data: {
          ...normalized,
          createdAt: normalized.occurredAt,
          updatedAt: normalized.occurredAt,
        },
      });
      return { ...normalized, _id: result._id };
    },
    async updateWeight(edge) {
      const normalized = normalizeEdge({ ...edge, occurredAt: edge.occurredAt || now().toISOString() });
      const result = await db.collection(collectionName).where({
        sourceId: normalized.sourceId,
        targetId: normalized.targetId,
        edgeType: normalized.edgeType,
      }).limit(1).get();
      const existing = result.data[0];
      if (!existing) return this.addEdge(normalized);
      const weight = Math.max(0, Number(existing.weight || 0) + Number(edge.delta || normalized.weight || 1));
      await db.collection(collectionName).doc(existing._id).update({ data: { weight, updatedAt: normalized.occurredAt } });
      return { ...existing, weight, updatedAt: normalized.occurredAt };
    },
    async getGraph(query = {}) {
      const result = await db.collection(collectionName).limit(1000).get();
      const edges = filterEdges(result.data || [], query);
      return {
        edges,
        sourceId: query.sourceId || "",
        targetId: query.targetId || "",
        edgeCount: edges.length,
        totalWeight: edges.reduce((sum, edge) => sum + Number(edge.weight || 0), 0),
      };
    },
  };
}

function detectLongTermPatterns(graph = {}) {
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const cancelWeight = edges
    .filter((edge) => edge.edgeType === "cancel")
    .reduce((sum, edge) => sum + Number(edge.weight || 0), 0);
  const rebookWeight = edges
    .filter((edge) => ["rebook", "order_response", "order_created", "completed"].includes(edge.edgeType))
    .reduce((sum, edge) => sum + Number(edge.weight || 0), 0);
  const times = edges
    .map((edge) => new Date(edge.occurredAt || edge.createdAt || edge.updatedAt || 0).getTime())
    .filter((value) => Number.isFinite(value) && value > 0);
  const spanDays = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / (24 * 60 * 60 * 1000) : 0;
  if (cancelWeight >= 3 && rebookWeight >= 1 && spanDays >= 14) {
    return { graphRiskScore: 70, behaviorPatternType: "long_term_cancel_rebook_loop", spanDays, cancelWeight, rebookWeight };
  }
  if (edges.length >= 8 && spanDays >= 14) {
    return { graphRiskScore: 45, behaviorPatternType: "dense_long_term_cluster", spanDays, cancelWeight, rebookWeight };
  }
  return { graphRiskScore: 0, behaviorPatternType: "normal", spanDays, cancelWeight, rebookWeight };
}

module.exports = {
  createBehaviorGraphStore,
  createMemoryBehaviorGraphStore,
  detectLongTermPatterns,
  edgeKey,
  filterEdges,
  normalizeEdge,
};
