function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export function buildPonPortSearchText(port) {
  return [
    port?.oltIp,
    port?.ponPort,
    port?.chassis,
    port?.board,
    port?.pon,
    port?.outerVlan,
    port?.address
  ].map((value) => String(value || "")).join(" ").toLowerCase();
}

export function createPonPortFilterState() {
  let baselines = new WeakMap();

  function snapshot(port) {
    return {
      oltIp: String(port?.oltIp || ""),
      ponPort: String(port?.ponPort || ""),
      searchText: buildPonPortSearchText(port || {})
    };
  }

  function baselineFor(port) {
    if (!port || typeof port !== "object") return snapshot(port);
    if (!baselines.has(port)) baselines.set(port, snapshot(port));
    return baselines.get(port);
  }

  return {
    reset(ports = []) {
      baselines = new WeakMap();
      ports.forEach((port) => {
        if (port && typeof port === "object") baselines.set(port, snapshot(port));
      });
    },
    rows({ ponPorts = [], keyword = "", selectedHost = "" }) {
      const normalizedKeyword = normalizeText(keyword);
      const normalizedSelectedHost = String(selectedHost || "");
      return ponPorts
        .map((port, index) => {
          const baseline = baselineFor(port);
          const currentSearchText = buildPonPortSearchText(port);
          return {
            port,
            __index: index,
            __sortOltIp: baseline.oltIp || port.oltIp || "",
            __sortPonPort: baseline.ponPort || port.ponPort || "",
            __matchesSelectedHost: !normalizedSelectedHost || port.oltIp === normalizedSelectedHost || baseline.oltIp === normalizedSelectedHost,
            searchText: `${baseline.searchText} ${currentSearchText}`
          };
        })
        .filter((row) => normalizedKeyword || row.__matchesSelectedHost)
        .filter((row) => !normalizedKeyword || row.searchText.includes(normalizedKeyword))
        .sort((left, right) => {
          const leftSelected = normalizedSelectedHost && (left.port.oltIp === normalizedSelectedHost || left.__sortOltIp === normalizedSelectedHost) ? 0 : 1;
          const rightSelected = normalizedSelectedHost && (right.port.oltIp === normalizedSelectedHost || right.__sortOltIp === normalizedSelectedHost) ? 0 : 1;
          if (normalizedKeyword && leftSelected !== rightSelected) return leftSelected - rightSelected;
          const oltCompare = String(left.__sortOltIp || left.port.oltIp || "").localeCompare(String(right.__sortOltIp || right.port.oltIp || ""), "zh-Hans-CN", { numeric: true });
          if (normalizedKeyword && oltCompare) return oltCompare;
          const ponCompare = String(left.__sortPonPort || left.port.ponPort || "").localeCompare(String(right.__sortPonPort || right.port.ponPort || ""), "zh-Hans-CN", { numeric: true });
          if (ponCompare) return ponCompare;
          return left.__index - right.__index;
        });
    }
  };
}
