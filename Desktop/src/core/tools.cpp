#include "tools.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QThread>

#include "agents.h"
#include "artifacts.h"
#include "chromium.h"
#include "datastore.h"
#include "mcp.h"
#include "search.h"
#include "sandbox.h"

namespace omnia {

QString computerSystemNote() {
  return QStringLiteral(
      "You drive a REAL Chromium browser (1280×800) shared with the user — they watch every step "
      "live in the Chromium panel. Observe (read/screenshot), then emit ONE precise action at a "
      "time. Never claim you opened a page you didn't navigate to. If a tool says the user has "
      "control, stop using the computer and wait.\n\n"
      "Browsing like a human researcher (mandatory for factual/current/research questions):\n"
      "1. START with computer_search (real Google SERP) — never jump straight to a URL from "
      "memory.\n"
      "2. Pick 3–5 results from DIFFERENT domains, open each with computer_navigate, read with "
      "computer_read, scroll for more.\n"
      "3. Cross-check the same fact across at least 2–3 sources; run a second search with a "
      "rephrased query if coverage is thin.\n"
      "4. Only then consolidate everything into one clear answer, citing sources as markdown "
      "links [title](url). Never answer from a single website.");
}

static LlmToolSpec spec(const QString& name, const QString& description,
                        const QJsonObject& properties, const QStringList& required = {}) {
  LlmToolSpec s;
  s.name = name;
  s.description = description;
  s.parameters = QJsonObject{{"type", "object"},
                             {"properties", properties},
                             {"required", stringArray(required)}};
  return s;
}

static QJsonObject prop(const QString& type, const QString& description,
                        const QJsonValue& def = QJsonValue()) {
  QJsonObject o{{"type", type}, {"description", description}};
  if (!def.isUndefined()) o.insert("default", def);
  return o;
}

QVector<LlmToolSpec> buildToolSpecs(const ChatSettings& settings) {
  QVector<LlmToolSpec> out;
  for (const QString& t : settings.tools) {
    if (t == "webSearch") {
      out.push_back(spec(
          "webSearch",
          "Search the web. Use this for current events, recent information, prices, news, "
          "research, or anything not in your training data. Returns ranked results with titles, "
          "snippets and URLs. IMPORTANT citation rule: every factual claim MUST end with an "
          "inline citation like [1], [2] referring to the result NUMBER (result 1 → [1]). Never "
          "invent citations.",
          {{"query", prop("string", "concise, specific search query")},
           {"maxResults", prop("number", "1-15", 8)}},
          {"query"}));
    } else if (t == "createArtifact") {
      out.push_back(spec(
          "createArtifact",
          "Create a rich standalone artifact document rendered in the side panel. Use for code "
          "files, markdown, HTML, SVGs, tables, mermaid and long structured documents.",
          {{"title", prop("string", "concise descriptive title")},
           {"type",
            QJsonObject{{"type", "string"},
                        {"enum",
                         stringArray({"text", "code", "markdown", "html", "svg", "table",
                                      "mermaid"})},
                        {"description", "artifact type"}}},
           {"language", prop("string", "language tag for code artifacts")},
           {"content", prop("string", "full artifact content")}},
          {"title", "type", "content"}));
    } else if (t == "runAgentTask") {
      out.push_back(spec(
          "runAgentTask",
          "Run a task in an isolated Docker sandbox (an agent). Use for generating "
          "PDF/DOCX/XLSX/CSV/markdown deliverables, running and testing multi-file code, deep "
          "web research with a live Chromium browser, scraping, batch file work, or anything "
          "that needs a shell + filesystem. Output files become viewable artifacts.",
          {{"task", prop("string", "precise instructions for the agent")},
           {"research", prop("boolean", "browse the web and cross-check sources", false)},
           {"wait", prop("boolean", "block until finished", true)},
           {"maxWaitSeconds", prop("number", "5-900", 300)}},
          {"task"}));
    } else if (t == "computerUse") {
      const QString note = computerSystemNote();
      out.push_back(spec(
          "computer_search",
          "Search Google like a human would and return ranked organic results. ALWAYS start web "
          "research with this. " + note,
          {{"query", prop("string", "search query")},
           {"max", prop("number", "3-15 results", 8)}},
          {"query"}));
      out.push_back(spec("computer_navigate",
                         "Open a URL in the shared Chromium browser and read it. " + note,
                         {{"url", prop("string", "full http(s) URL")}}, {"url"}));
      out.push_back(spec("computer_click",
                         "Click at page coordinates (viewport 1280×800) or a CSS selector. " + note,
                         {{"x", prop("number", "X coordinate")},
                          {"y", prop("number", "Y coordinate")},
                          {"selector", prop("string", "CSS selector alternative")}}));
      out.push_back(spec("computer_type",
                         "Type into the focused element (click first if needed). " + note,
                         {{"text", prop("string", "text to type")},
                          {"enter", prop("boolean", "press Enter after", false)}},
                         {"text"}));
      out.push_back(spec("computer_press", "Press a key or hotkey (Enter, Escape, Control+l). " + note,
                         {{"key", prop("string", "key or hotkey")}}, {"key"}));
      out.push_back(spec("computer_scroll", "Scroll the page up/down. " + note,
                         {{"direction", QJsonObject{{"type", "string"},
                                                    {"enum", stringArray({"up", "down"})},
                                                    {"default", "down"}}}}));
      out.push_back(spec("computer_read",
                         "Read the current page text (no screenshot spam). " + note, {}));
      out.push_back(spec("computer_screenshot",
                         "Look at the current page visually; records a screenshot step. " + note,
                         {}));
      out.push_back(spec("computer_nav",
                         "Browser back / forward / reload. " + note,
                         {{"op", QJsonObject{{"type", "string"},
                                             {"enum", stringArray({"back", "forward", "reload"})}}}},
                         {"op"}));
    }
  }
  for (const MCPToolInfo& m : McpRegistry::instance().allTools()) {
    out.push_back(spec(m.name, "[MCP:" + m.server + "] " + m.description, m.inputSchema));
  }
  return out;
}

static QJsonObject textResult(const QString& text) { return QJsonObject{{"result", text}}; }

static QJsonValue guardComputer() {
  if (ChromiumService::instance().control() == Control::User)
    return QJsonObject{
        {"control", "user"},
        {"message",
         "The user has taken control of Chromium — do NOT use computer tools right now. Wait for "
         "them to hand control back."}};
  QString err;
  if (!ChromiumService::instance().ensure(&err)) return QJsonObject{{"error", err}};
  return QJsonValue(QJsonValue::Null);
}

static QJsonObject errorResult(const QString& message) { return QJsonObject{{"error", message}}; }

QJsonValue executeTool(const QString& name, const QJsonObject& args, const ChatSettings& settings,
                       std::atomic<bool>* abort) {
  try {
    if (name == "webSearch") {
      const QString query = args.value("query").toString();
      const int max = qBound(1, int(args.value("maxResults").toDouble(8)), 15);
      QString engine;
      const QVector<SearchResult> results = searchWeb(query, max, &engine);
      QJsonArray arr;
      QStringList urls;
      for (const auto& r : results) {
        arr.append(QJsonObject{{"n", r.position},
                               {"title", r.title},
                               {"url", r.url},
                               {"hostname", r.hostname},
                               {"description", r.description}});
        urls.append(r.url);
      }
      return QJsonObject{
          {"query", query},
          {"engine", engine},
          {"results", arr},
          {"citationNote",
           "Cite these results inline as [1], [2] … matching result numbers exactly."}};
    }
    if (name == "createArtifact") {
      const ArtifactMeta a = createArtifact(args.value("title").toString(),
                                            args.value("type").toString("text"),
                                            args.value("content").toString(), {},
                                            args.value("language").toString());
      return QJsonObject{{"artifactId", a.id}, {"url", a.url}, {"title", a.title}};
    }
    if (name == "runAgentTask") {
      const QString task = args.value("task").toString();
      const bool wait = args.value("wait").toBool(true);
      const int maxWait = qBound(5, int(args.value("maxWaitSeconds").toDouble(300)), 900);
      const AgentMeta a = AgentsService::instance().spawn(
          task, settings.provider, settings.model, {}, {}, args.value("research").toBool());
      if (!wait)
        return QJsonObject{{"agentId", a.id},
                           {"status", a.status},
                           {"note", "Agent started in the background — watch it in the Agents "
                                    "panel."}};
      const qint64 deadline = nowMs() + qint64(maxWait) * 1000;
      while (nowMs() < deadline) {
        if (abort && abort->load()) return errorResult("aborted");
        QThread::msleep(1500);
        const AgentMeta cur = AgentsService::instance().get(a.id);
        if (cur.status == "done") {
          QJsonArray files;
          for (const QString& f : cur.files) {
            const ArtifactMeta art = getArtifact(f);
            if (!art.id.isEmpty())
              files.append(QJsonObject{{"artifactId", art.id},
                                       {"title", art.title},
                                       {"type", art.type},
                                       {"url", art.url}});
          }
          return QJsonObject{{"agentId", a.id},
                             {"status", "done"},
                             {"files", files},
                             {"summary", cur.summary}};
        }
        if (cur.status == "error" || cur.status == "stopped")
          return errorResult("agent " + cur.status + ": " + cur.error);
      }
      return QJsonObject{{"agentId", a.id},
                         {"status", "timeout"},
                         {"note", "Still running — see the Agents panel for progress."}};
    }
    if (name.startsWith("computer_")) {
      const QJsonValue blocked = guardComputer();
      if (blocked.isObject()) return blocked;
      auto& ch = ChromiumService::instance();
      const QString op = name.mid(9);
      if (op == "search") {
        const auto s = ch.search("model", args.value("query").toString(),
                                 int(args.value("max").toDouble(8)));
        QJsonArray arr;
        for (const auto& r : s.results)
          arr.append(QJsonObject{{"position", r.position},
                                 {"title", r.title},
                                 {"url", r.url},
                                 {"hostname", r.hostname}});
        if (arr.isEmpty())
          return QJsonObject{{"engine", s.engine},
                             {"results", arr},
                             {"note", "No organic results parsed — refine the query."}};
        return QJsonObject{{"engine", s.engine},
                           {"query", s.query},
                           {"results", arr},
                           {"note",
                            "Open 3–5 results from DIFFERENT domains, read each, cross-check, "
                            "then consolidate citing sources as markdown links."}};
      }
      if (op == "navigate") {
        const auto r = ch.navigate("model", args.value("url").toString());
        if (!r.ok) return errorResult(r.error);
        return QJsonObject{{"url", r.url},
                           {"title", r.title},
                           {"text", r.text},
                           {"note", "A screenshot was recorded to the Chromium timeline."}};
      }
      if (op == "click") {
        ChromiumResult r = args.contains("selector") && !(args.contains("x") && args.contains("y"))
                               ? ch.clickSelector("model", args.value("selector").toString())
                               : ch.click("model", int(args.value("x").toDouble(640)),
                                          int(args.value("y").toDouble(400)));
        if (!r.ok) return errorResult(r.error);
        const auto page = ChromiumService::instance().read();
        return QJsonObject{{"url", r.url}, {"title", r.title}, {"text", page.text}};
      }
      if (op == "type") {
        const auto r =
            ch.typeText("model", args.value("text").toString(), args.value("enter").toBool());
        if (!r.ok) return errorResult(r.error);
        return QJsonObject{{"url", r.url}, {"title", r.title}};
      }
      if (op == "press") {
        const auto r = ch.press("model", args.value("key").toString());
        if (!r.ok) return errorResult(r.error);
        return QJsonObject{{"url", r.url}, {"title", r.title}};
      }
      if (op == "scroll") {
        const auto r = ch.scroll("model", args.value("direction").toString("down"));
        if (!r.ok) return errorResult(r.error);
        return QJsonObject{{"url", r.url}, {"title", r.title}};
      }
      if (op == "read") {
        const auto r = ch.read();
        if (!r.ok) return errorResult(r.error);
        return QJsonObject{{"url", r.url}, {"title", r.title}, {"text", r.text}};
      }
      if (op == "screenshot") {
        const auto r = ch.shot();
        return QJsonObject{{"url", r.url},
                           {"title", r.title},
                           {"message", "Screenshot recorded to the Chromium timeline."}};
      }
      if (op == "nav") {
        const auto r = ch.nav("model", args.value("op").toString());
        if (!r.ok) return errorResult(r.error);
        return QJsonObject{{"url", r.url}, {"title", r.title}};
      }
      return errorResult("unknown computer op: " + op);
    }
    for (const MCPToolInfo& m : McpRegistry::instance().allTools()) {
      if (m.name == name) {
        const auto servers = McpRegistry::instance().servers();
        for (const auto& s : servers)
          if (s.name == m.server || s.id == m.server) {
            McpConnection conn(s);
            if (!conn.connectToServer()) return errorResult("MCP server unavailable: " + s.name);
            return conn.callTool(name, args);
          }
      }
    }
    return errorResult("unknown tool: " + name);
  } catch (const std::exception& e) {
    return errorResult(e.what());
  }
}

}  // namespace omnia
