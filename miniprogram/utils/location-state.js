function compact(parts) {
  return parts.filter((item) => item !== undefined && item !== null && String(item).trim() !== "");
}

function pickAddress(position) {
  const address = position.address || {};
  const component =
    position.address_component ||
    position.addressComponent ||
    position.regeocode?.addressComponent ||
    position.regeocode?.address_component ||
    address.addressComponent ||
    address.address_component ||
    address;
  return {
    province: component.province || position.province || "",
    city: component.city || position.city || "",
    district: component.district || position.district || "",
    street: component.street || component.township || component.town || position.street || "",
    addressText: position.addressText || position.formatted_addresses?.recommend || position.formattedAddress || "",
  };
}

function stripRegionPrefix(text, component) {
  let value = String(text || "");
  [component.province, component.city, component.district].filter(Boolean).forEach((part) => {
    value = value.replace(part, "");
  });
  return value.trim();
}

function buildLocationStateFromPosition(position) {
  const address = pickAddress(position || {});
  const hasRegion = Boolean(address.province || address.city || address.district || address.street);
  return {
    region: hasRegion ? [address.province || "", address.city || "", address.district || ""] : ["", "", ""],
    regionLabel: hasRegion ? [address.province, address.city, address.district].filter(Boolean).join(" / ") : "请手动确认省市区",
    street: hasRegion ? address.street || "" : "",
    addressText: hasRegion ? address.addressText || "" : "",
    currentPosition: {
      latitude: position.latitude,
      longitude: position.longitude,
    },
    resolved: hasRegion,
  };
}

function normalizeQQMapReverseGeocodeResult(response, fallback) {
  const result = response?.result || response || {};
  const component = result.address_component || result.addressComponent || {};
  const fallbackAddress =
    result.formatted_addresses?.recommend ||
    result.address ||
    (result.pois && result.pois[0] && result.pois[0].address) ||
    "";
  const street =
    component.street ||
    component.township ||
    component.town ||
    stripRegionPrefix(fallbackAddress, component) ||
    "";
  return {
    province: component.province || "",
    city: component.city || "",
    district: component.district || "",
    street,
    addressText: fallbackAddress,
    latitude: fallback?.latitude || result.location?.lat || null,
    longitude: fallback?.longitude || result.location?.lng || null,
  };
}

function locationDisplayText(state) {
  if (!state || !state.resolved) return "定位成功，请手动确认省市区";
  if (state.addressText) return state.addressText;
  return compact([...(state.region || []), state.street]).join(" / ") || "定位成功，请手动确认省市区";
}

function removeRecentLocationAt(recent, index) {
  return (recent || []).filter((_, itemIndex) => itemIndex !== Number(index));
}

module.exports = {
  buildLocationStateFromPosition,
  locationDisplayText,
  normalizeQQMapReverseGeocodeResult,
  removeRecentLocationAt,
};
