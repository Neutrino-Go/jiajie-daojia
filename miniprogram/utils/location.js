const { getCurrentLocation, setCurrentLocation } = require("./session");
const { QQ_MAP_KEY } = require("../config/map.js");
const { normalizeQQMapReverseGeocodeResult } = require("./location-state");

function pickCoordinate(location, keys) {
  for (const key of keys) {
    if (location && location[key] !== undefined && location[key] !== null && location[key] !== "") {
      const value = Number(location[key]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function compactText(parts) {
  return (parts || []).filter(Boolean).join(" ");
}

function inLatitudeRange(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function inLongitudeRange(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function normalizeLocation(location) {
  if (!location) return null;
  const nested = location.location || location.currentLocation || location.currentPosition || location.lastLocation || {};
  let latitude = pickCoordinate(location, ["latitude", "lat"]);
  let longitude = pickCoordinate(location, ["longitude", "lng", "lon"]);
  if (latitude === null) latitude = pickCoordinate(nested, ["latitude", "lat"]);
  if (longitude === null) longitude = pickCoordinate(nested, ["longitude", "lng", "lon"]);

  if (!inLatitudeRange(latitude) && inLatitudeRange(longitude) && inLongitudeRange(latitude)) {
    const nextLatitude = longitude;
    longitude = latitude;
    latitude = nextLatitude;
  }

  if (!inLatitudeRange(latitude) || !inLongitudeRange(longitude)) return null;

  return {
    latitude,
    longitude,
    province: location.province || nested.province || "",
    city: location.city || nested.city || "",
    district: location.district || nested.district || "",
    street: location.street || nested.street || "",
    community: location.community || nested.community || "",
    addressText: location.addressText || nested.addressText || location.address || nested.address || "",
  };
}

function placeText(location) {
  if (!location) return "";
  return compactText([location.province, location.city, location.district, location.street, location.community, location.addressText]);
}

function sameOrSimilarPlace(from, to) {
  if (!from || !to) return false;
  if (from.city && to.city && from.city === to.city) return true;
  if (from.district && to.district && from.district === to.district) return true;
  const fromText = placeText(from);
  const toText = placeText(to);
  return Boolean(fromText && toText && (fromText.includes(toText) || toText.includes(fromText)));
}

function rawDistanceKm(from, to) {
  const earthRadiusKm = 6371;
  const fromLat = (from.latitude * Math.PI) / 180;
  const toLat = (to.latitude * Math.PI) / 180;
  const deltaLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const deltaLng = ((to.longitude - from.longitude) * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusKm * c * 10) / 10;
}

function calculateDistanceKm(from, to, options = {}) {
  const userLocation = normalizeLocation(from);
  const cleanerLocation = normalizeLocation(to);
  if (!userLocation || !cleanerLocation) return null;
  const distanceKm = rawDistanceKm(userLocation, cleanerLocation);
  if (distanceKm > 100 && sameOrSimilarPlace(userLocation, cleanerLocation)) {
    console.warn("[distance abnormal]", {
      userLocation,
      cleanerLocation,
      distanceKm,
      cleanerName: options.cleanerName || "",
    });
    return null;
  }
  return distanceKm;
}

function distanceDisplay(from, to, options = {}) {
  const userLocation = normalizeLocation(from);
  const cleanerLocation = normalizeLocation(to);
  if (!userLocation || !cleanerLocation) {
    return { distanceKm: null, distanceText: "距离未知", distanceStatus: "unknown", userLocation, cleanerLocation };
  }
  const distanceKm = rawDistanceKm(userLocation, cleanerLocation);
  if (distanceKm > 100 && sameOrSimilarPlace(userLocation, cleanerLocation)) {
    console.warn("[distance abnormal]", {
      userLocation,
      cleanerLocation,
      distanceKm,
      cleanerName: options.cleanerName || "",
    });
    return { distanceKm: null, distanceText: "距离待确认", distanceStatus: "pending", userLocation, cleanerLocation };
  }
  return {
    distanceKm,
    distanceText: distanceKm < 1 ? "<1km" : `${distanceKm.toFixed(1)}km`,
    distanceStatus: "valid",
    userLocation,
    cleanerLocation,
  };
}

function loadQQMapWX() {
  try {
    return require("./qqmap-wx-jssdk.js");
  } catch (error) {
    return null;
  }
}

function enrichReverseGeocodeError(error) {
  if (error instanceof Error) return error;
  const message = error && (error.message || error.msg || error.errMsg);
  const next = new Error(message || "腾讯地图逆地址解析失败");
  if (error && error.status !== undefined) next.status = error.status;
  if (error && error.errMsg) next.errMsg = error.errMsg;
  next.data = error;
  return next;
}

function reverseGeocode(latitude, longitude) {
  return new Promise((resolve, reject) => {
    const QQMapWX = loadQQMapWX();
    if (!QQMapWX) {
      reject(new Error("地图SDK未安装，请检查 qqmap-wx-jssdk.js"));
      return;
    }
    if (!QQ_MAP_KEY) {
      reject(new Error("请先配置腾讯位置服务 Key"));
      return;
    }
    const qqmapsdk = new QQMapWX({ key: QQ_MAP_KEY });
    qqmapsdk.reverseGeocoder({
      location: {
        latitude,
        longitude,
      },
      success: (response) => {
        console.log("[逆地址解析结果]", response);
        resolve(normalizeQQMapReverseGeocodeResult(response, { latitude, longitude }));
      },
      fail: (error) => {
        const next = enrichReverseGeocodeError(error);
        console.error("[逆地址解析失败]", {
          status: next.status,
          message: next.message,
          errMsg: next.errMsg,
          data: next.data,
        });
        reject(next);
      },
    });
  });
}

function getRuntimeLocation() {
  const current = getCurrentLocation();
  return new Promise((resolve) => {
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      success: (res) => {
        resolve({
          province: current.province || "",
          city: current.city || "",
          district: current.district || "",
          street: current.street || "",
          latitude: res.latitude,
          longitude: res.longitude,
        });
      },
      fail: () => {
        resolve({
          province: current.province || "",
          city: current.city || "",
          district: current.district || "",
          street: current.street || "",
          latitude: current.latitude || null,
          longitude: current.longitude || null,
        });
      },
    });
  });
}

async function getCurrentLocationForDistance(fallbackLocation) {
  const currentLocation = getCurrentLocation();
  if (normalizeLocation(currentLocation)) return currentLocation;
  if (normalizeLocation(fallbackLocation)) return fallbackLocation;
  const runtimeLocation = await getRuntimeLocation().catch(() => null);
  if (normalizeLocation(runtimeLocation)) {
    return setCurrentLocation({ ...currentLocation, ...runtimeLocation });
  }
  return null;
}

module.exports = {
  getRuntimeLocation,
  getCurrentLocationForDistance,
  normalizeLocation,
  calculateDistanceKm,
  distanceDisplay,
  reverseGeocode,
};
