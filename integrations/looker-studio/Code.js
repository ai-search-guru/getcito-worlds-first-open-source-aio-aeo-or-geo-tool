/**
 * GetCito Looker Studio Community Connector.
 *
 * Pulls read-only metrics from the Public Metrics API (`/api/v1/*`, see
 * docs → API Reference → Metrics API) so agencies can blend AI visibility
 * data with GA4 / Search Console in one dashboard. Authenticates with a
 * GetCito API key (Settings → MCP & API Keys, prefix `getcito_`).
 *
 * Apps Script project — deploy with clasp or paste into script.google.com.
 * Self-hosters: change BASE_URL below AND the urlFetchWhitelist entry in
 * appsscript.json to your web app's origin.
 */

var cc = DataStudioApp.createCommunityConnector();

// Set to this deployment's HTTPS web app origin before deploying the connector.
var BASE_URL = "";
var KEY_PROPERTY = "getcito.apiKey";
/** Per-chart fetches repeat on every viewer interaction — cache API reads. */
var CACHE_TTL_SECONDS = 300;

var REPORT_TYPES = [
  { id: "visibility_trend", label: "Visibility Trend (daily)" },
  { id: "share_of_voice", label: "Share of Voice by Platform" },
  { id: "citations_domains", label: "Citations — Top Domains" },
  { id: "ai_traffic_platforms", label: "AI Traffic by Platform" },
];

// ─── Auth ────────────────────────────────────────────────────────────────────

function getAuthType() {
  return cc
    .newAuthTypeResponse()
    .setAuthType(cc.AuthType.KEY)
    .setHelpUrl(
      "https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/blob/main/docs/api-reference/metrics.mdx",
    )
    .build();
}

function isAdminUser() {
  return false;
}

function checkForValidKey(key) {
  if (!key || key.indexOf("getcito_") !== 0) return false;
  var response = UrlFetchApp.fetch(baseUrl() + "/api/v1/whoami", {
    headers: { Authorization: "Bearer " + key },
    muteHttpExceptions: true,
  });
  return response.getResponseCode() === 200;
}

function setCredentials(request) {
  var key = request.key;
  if (!checkForValidKey(key)) {
    return { errorCode: "INVALID_CREDENTIALS" };
  }
  PropertiesService.getUserProperties().setProperty(KEY_PROPERTY, key);
  return { errorCode: "NONE" };
}

function isAuthValid() {
  var key = PropertiesService.getUserProperties().getProperty(KEY_PROPERTY);
  return checkForValidKey(key);
}

function resetAuth() {
  PropertiesService.getUserProperties().deleteProperty(KEY_PROPERTY);
}

// ─── API helper ──────────────────────────────────────────────────────────────

function throwUserError(message) {
  cc.newUserError().setText(message).throwException();
}

function baseUrl() {
  if (!/^https:\/\/[^/]+\/?$/.test(BASE_URL)) {
    throwUserError(
      "The connector needs its GetCito web app address. Set BASE_URL and urlFetchWhitelist before deploying.",
    );
  }
  return BASE_URL.replace(/\/$/, "");
}

/**
 * GET an /api/v1 path with the stored key, short-cache the parsed JSON.
 * Cache key includes the API key hash so two data sources with different
 * keys never share entries.
 */
function apiGet(path, params) {
  var key = PropertiesService.getUserProperties().getProperty(KEY_PROPERTY);
  if (!key)
    throwUserError(
      "Your GetCito API key is missing — reconnect the data source.",
    );

  var query = [];
  for (var name in params) {
    if (
      params[name] !== undefined &&
      params[name] !== null &&
      params[name] !== ""
    ) {
      query.push(
        encodeURIComponent(name) + "=" + encodeURIComponent(params[name]),
      );
    }
  }
  var url = baseUrl() + path + (query.length ? "?" + query.join("&") : "");

  var cache = CacheService.getUserCache();
  var cacheKey = Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url + "|" + key),
  );
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + key },
    muteHttpExceptions: true,
  });
  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code === 401)
    throwUserError("GetCito rejected the API key — it may have been revoked.");
  if (code === 404)
    throwUserError("Brand not found — pick a brand this API key can access.");
  if (code !== 200)
    throwUserError("GetCito API error (" + code + "). Try again in a minute.");

  // CacheService caps values at ~100KB; oversized payloads just skip the cache.
  if (body.length < 90000) {
    cache.put(cacheKey, body, CACHE_TTL_SECONDS);
  }
  return JSON.parse(body);
}

// ─── Config ──────────────────────────────────────────────────────────────────

function getConfig() {
  var config = cc.getConfig();

  config
    .newInfo()
    .setId("instructions")
    .setText(
      "Pick the brand and the metric set this data source should expose.",
    );

  var brandSelect = config
    .newSelectSingle()
    .setId("brandId")
    .setName("Brand")
    .setHelpText("Brands your API key can access.");
  var brands = apiGet("/api/v1/brands", {}).brands || [];
  if (brands.length === 0) {
    throwUserError(
      "No brands found for this API key — create a brand in GetCito first.",
    );
  }
  brands.forEach(function (brand) {
    brandSelect.addOption(
      config.newOptionBuilder().setLabel(brand.name).setValue(brand.id),
    );
  });

  var typeSelect = config
    .newSelectSingle()
    .setId("reportType")
    .setName("Metric set")
    .setHelpText(
      "Each metric set has its own fields; use one data source per set.",
    );
  REPORT_TYPES.forEach(function (type) {
    typeSelect.addOption(
      config.newOptionBuilder().setLabel(type.label).setValue(type.id),
    );
  });

  config.setDateRangeRequired(true);
  return config.build();
}

// ─── Schema ──────────────────────────────────────────────────────────────────

function getFieldsFor(reportType) {
  var fields = cc.getFields();
  var types = cc.FieldType;
  var aggregations = cc.AggregationType;

  if (reportType === "visibility_trend") {
    fields
      .newDimension()
      .setId("date")
      .setName("Date")
      .setType(types.YEAR_MONTH_DAY);
    fields
      .newMetric()
      .setId("ai_visibility_score")
      .setName("Visibility (AI Visibility Score)")
      .setType(types.NUMBER)
      .setAggregation(aggregations.AVG);
    fields
      .newMetric()
      .setId("avg_visibility_score")
      .setName("Avg Visibility Score")
      .setType(types.NUMBER)
      .setAggregation(aggregations.AVG);
    fields
      .newMetric()
      .setId("total_mentions")
      .setName("Mentions")
      .setType(types.NUMBER)
      .setAggregation(aggregations.SUM);
    fields
      .newMetric()
      .setId("total_citations")
      .setName("Citations")
      .setType(types.NUMBER)
      .setAggregation(aggregations.SUM);
    fields
      .newMetric()
      .setId("result_count")
      .setName("Tracked Results")
      .setType(types.NUMBER)
      .setAggregation(aggregations.SUM);
    fields
      .newMetric()
      .setId("avg_competitor_score")
      .setName("Avg Competitor Score")
      .setType(types.NUMBER)
      .setAggregation(aggregations.AVG);
  } else if (reportType === "share_of_voice") {
    fields
      .newDimension()
      .setId("platform")
      .setName("Platform")
      .setType(types.TEXT);
    fields
      .newMetric()
      .setId("brand_mentions")
      .setName("Brand Mentions")
      .setType(types.NUMBER)
      .setAggregation(aggregations.SUM);
    fields
      .newMetric()
      .setId("competitor_mentions")
      .setName("Competitor Mentions")
      .setType(types.NUMBER)
      .setAggregation(aggregations.SUM);
    fields
      .newMetric()
      .setId("sov_pct")
      .setName("Share of Voice %")
      .setType(types.PERCENT);
  } else if (reportType === "citations_domains") {
    fields.newDimension().setId("domain").setName("Domain").setType(types.TEXT);
    fields
      .newDimension()
      .setId("category")
      .setName("Source Category")
      .setType(types.TEXT);
    fields
      .newMetric()
      .setId("total_citations")
      .setName("Citations")
      .setType(types.NUMBER)
      .setAggregation(aggregations.SUM);
    fields
      .newMetric()
      .setId("results_citing")
      .setName("Results Citing")
      .setType(types.NUMBER)
      .setAggregation(aggregations.SUM);
    fields
      .newMetric()
      .setId("usage_pct")
      .setName("Usage %")
      .setType(types.PERCENT);
  } else if (reportType === "ai_traffic_platforms") {
    fields
      .newDimension()
      .setId("platform")
      .setName("Platform")
      .setType(types.TEXT);
    fields
      .newMetric()
      .setId("visits")
      .setName("Visits")
      .setType(types.NUMBER)
      .setAggregation(aggregations.SUM);
  } else {
    throwUserError("Unknown metric set — edit the data source and pick one.");
  }

  return fields;
}

function getSchema(request) {
  var reportType = request.configParams && request.configParams.reportType;
  return { schema: getFieldsFor(reportType).build() };
}

// ─── Data ────────────────────────────────────────────────────────────────────

/** Looker's PERCENT type expects a 0–1 fraction; the API returns 0–100. */
function toFraction(pct) {
  return typeof pct === "number" ? pct / 100 : null;
}

function fetchRowObjects(reportType, brandId, dateFrom, dateTo) {
  var window = { brand_id: brandId, date_from: dateFrom, date_to: dateTo };

  if (reportType === "visibility_trend") {
    var trend = apiGet("/api/v1/visibility-trend", {
      brand_id: brandId,
      date_from: dateFrom,
      date_to: dateTo,
      granularity: "day",
    });
    return (trend.buckets || []).map(function (bucket) {
      return {
        date: bucket.date.replace(/-/g, ""),
        ai_visibility_score: bucket.ai_visibility_score,
        avg_visibility_score: bucket.avg_visibility_score,
        total_mentions: bucket.total_mentions,
        total_citations: bucket.total_citations,
        result_count: bucket.result_count,
        avg_competitor_score: bucket.avg_competitor_score,
      };
    });
  }

  if (reportType === "share_of_voice") {
    var comparison = apiGet("/api/v1/competitor-comparison", window);
    var byPlatform =
      (comparison.share_of_voice && comparison.share_of_voice.by_platform) ||
      [];
    return byPlatform.map(function (row) {
      return {
        platform: row.platform || row.model_used || "unknown",
        brand_mentions: row.brand_mentions,
        competitor_mentions: row.competitor_mentions,
        sov_pct: toFraction(row.sov_pct),
      };
    });
  }

  if (reportType === "citations_domains") {
    var citations = apiGet("/api/v1/citations", window);
    return (citations.top_domains || []).map(function (row) {
      return {
        domain: row.domain,
        category: row.category,
        total_citations: row.total_citations,
        results_citing: row.results_citing,
        usage_pct: toFraction(row.usage_pct),
      };
    });
  }

  if (reportType === "ai_traffic_platforms") {
    var traffic = apiGet("/api/v1/ai-traffic", window);
    return (traffic.platform_breakdown || []).map(function (row) {
      return { platform: row.platform, visits: row.visits };
    });
  }

  throwUserError("Unknown metric set — edit the data source and pick one.");
}

function getData(request) {
  var configParams = request.configParams || {};
  var brandId = configParams.brandId;
  var reportType = configParams.reportType;
  if (!brandId || !reportType) {
    throwUserError(
      "The data source is missing its brand or metric set — edit and reconfigure.",
    );
  }

  var requestedFields = getFieldsFor(reportType).forIds(
    request.fields.map(function (field) {
      return field.name;
    }),
  );

  var rowObjects = fetchRowObjects(
    reportType,
    brandId,
    request.dateRange.startDate,
    request.dateRange.endDate,
  );

  var rows = rowObjects.map(function (rowObject) {
    return {
      values: requestedFields.asArray().map(function (field) {
        var value = rowObject[field.getId()];
        return value === undefined || value === null ? "" : value;
      }),
    };
  });

  return { schema: requestedFields.build(), rows: rows };
}
