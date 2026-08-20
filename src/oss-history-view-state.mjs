export function ossHistoricalOpticalRequestFor({ detail = {}, dateRange = [] } = {}) {
  const [startDate, endDate] = Array.isArray(dateRange) ? dateRange : [];
  if (!detail?.olt?.id || !detail?.onu || !startDate || !endDate) {
    return { ok: false, error: "ONU 详情或日期范围不完整" };
  }
  return {
    ok: true,
    payload: {
      oltId: detail.olt.id,
      chassis: detail.onu.chassis,
      board: detail.onu.board ?? detail.onu.slot,
      pon: detail.onu.pon,
      onuId: detail.onu.onuId,
      startDate,
      endDate
    }
  };
}

export function ossHistoryRowsFromResponse(result = {}) {
  return Array.isArray(result.rows) ? result.rows : [];
}
