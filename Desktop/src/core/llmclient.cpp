#include "llmclient.h"

#include <QEventLoop>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>

#include "datastore.h"
#include "models.h"

namespace omnia {

static QString jsonToQs(const QJsonValue& v) {
  if (v.isString()) return v.toString();
  if (v.isObject())
    return QString::fromUtf8(QJsonDocument(v.toObject()).toJson(QJsonDocument::Compact));
  if (v.isArray())
    return QString::fromUtf8(QJsonDocument(v.toArray()).toJson(QJsonDocument::Compact));
  if (v.isBool()) return v.toBool() ? "true" : "false";
  if (v.isNull() || v.isUndefined()) return {};
  return QString::number(v.toDouble());
}

QString providerErrorMessage(const QString& provider, const QString& raw, int status) {
  const QString t = raw.left(400);
  if (status == 401 || status == 403)
    return "Authentication failed for " + provider + " (" + QString::number(status) +
           "). Check the API key in Settings → API keys. " + t;
  if (status == 404)
    return "Model not found (404) for " + provider +
           ". The model may be retired or misspelled — try Models → refresh. " + t;
  if (status == 429)
    return "Rate limited by " + provider + " (429). Wait a moment and retry. " + t;
  if (status >= 500) return provider + " server error (" + QString::number(status) + "). " + t;
  if (raw.contains("api key", Qt::CaseInsensitive) ||
      raw.contains("authentication", Qt::CaseInsensitive))
    return "Missing or invalid API key for " + provider + ". " + t;
  if (raw.contains("retired", Qt::CaseInsensitive) ||
      raw.contains("decommissioned", Qt::CaseInsensitive))
    return "This model appears retired. Pick another model in the header. " + t;
  return t.isEmpty() ? provider + " request failed (" + QString::number(status) + ")" : t;
}

static QString anthropicUrl(const QString& base) {
  QString b = base;
  while (b.endsWith('/')) b.chop(1);
  if (b.endsWith("/v1")) return b + "/messages";
  return b + "/v1/messages";
}

static QJsonArray contentOfMessage(const ChatMessage& m, const QString& provider, bool vision) {
  QJsonArray blocks;
  for (const MessagePart& p : m.parts) {
    if (p.kind == MessagePart::Text && !p.text.text.isEmpty())
      blocks.append(QJsonObject{{"type", "text"}, {"text", p.text.text}});
    if (p.kind == MessagePart::File && vision && !p.file.data.isEmpty()) {
      QString mime = p.file.mime.isEmpty() ? "application/octet-stream" : p.file.mime;
      QByteArray b64 = p.file.data.toBase64();
      if (p.file.data.startsWith("data:")) {
        const int comma = p.file.data.indexOf(',');
        const QByteArray head = p.file.data.left(comma);
        mime = QString::fromLatin1(head.mid(5, head.indexOf(';') - 5));
        b64 = p.file.data.mid(comma + 1);
      }
      blocks.append(QJsonObject{{"type", "image"},
                                {"source",
                                 QJsonObject{{"type", "base64"},
                                             {"media_type", mime},
                                             {"data", QString::fromLatin1(b64)}}}});
    }
  }
  return blocks;
}

static QJsonObject buildAnthropic(const ChatRequest& req) {
  QJsonObject body{{"model", req.model},
                   {"max_tokens", req.maxTokens},
                   {"stream", true},
                   {"system", req.system}};
  if (req.thinking && modelSupportsThinking(req.provider, req.model))
    body.insert("thinking", QJsonObject{{"type", "enabled"}, {"budget_tokens", 4096}});
  if (!req.tools.isEmpty()) {
    QJsonArray tools;
    for (const auto& t : req.tools) {
      QJsonObject params = t.parameters;
      if (!params.contains("type")) params.insert("type", "object");
      tools.append(
          QJsonObject{{"name", t.name}, {"description", t.description}, {"input_schema", params}});
    }
    body.insert("tools", tools);
  }
  QJsonArray messages;
  const bool vision = findModel(req.provider, req.model).supportsVision;
  for (const ChatMessage& m : req.messages) {
    if (m.role == "assistant") {
      QJsonArray blocks;
      for (const MessagePart& p : m.parts) {
        if (p.kind == MessagePart::Text && !p.text.text.isEmpty())
          blocks.append(QJsonObject{{"type", "text"}, {"text", p.text.text}});
        if (p.kind == MessagePart::ToolCall) {
          blocks.append(QJsonObject{{"type", "tool_use"},
                                    {"id", p.toolCall.id},
                                    {"name", p.toolCall.name},
                                    {"input", p.toolCall.input}});
        }
      }
      if (blocks.isEmpty()) continue;
      messages.append(QJsonObject{{"role", "assistant"}, {"content", blocks}});
    } else {
      QJsonArray blocks;
      bool hasToolResult = false;
      for (const MessagePart& p : m.parts) {
        if (p.kind == MessagePart::ToolResult) {
          hasToolResult = true;
          QJsonObject tr{{"type", "tool_result"},
                          {"tool_use_id", p.toolResult.toolCallId}};
          const QString content = jsonToQs(p.toolResult.output);
          tr.insert("content", content);
          tr.insert("is_error", p.toolResult.output.isObject() &&
                                    p.toolResult.output.toObject().contains("error"));
          blocks.append(tr);
        }
      }
      if (!hasToolResult) {
        const QJsonArray content = contentOfMessage(m, req.provider, vision);
        if (content.isEmpty()) continue;
        blocks = content;
      }
      messages.append(QJsonObject{{"role", "user"}, {"content", blocks}});
    }
  }
  body.insert("messages", messages);
  return body;
}

static QJsonArray openAiTools(const ChatRequest& req) {
  QJsonArray tools;
  for (const auto& t : req.tools) {
    QJsonObject params = t.parameters;
    if (!params.contains("type")) params.insert("type", "object");
    tools.append(QJsonObject{{"type", "function"},
                             {"function",
                              QJsonObject{{"name", t.name},
                                          {"description", t.description},
                                          {"parameters", params}}}});
  }
  return tools;
}

static QJsonObject buildOpenAi(const ChatRequest& req) {
  QJsonObject body{{"model", req.model}, {"stream", true}, {"messages", QJsonArray()}};
  QJsonArray messages;
  if (!req.system.isEmpty())
    messages.append(QJsonObject{{"role", "system"}, {"content", req.system}});
  const bool vision = findModel(req.provider, req.model).supportsVision;
  for (const ChatMessage& m : req.messages) {
    if (m.role == "assistant") {
      QString text;
      QJsonArray toolCalls;
      for (const MessagePart& p : m.parts) {
        if (p.kind == MessagePart::Text) text += p.text.text;
        if (p.kind == MessagePart::ToolCall)
          toolCalls.append(QJsonObject{
              {"id", p.toolCall.id},
              {"type", "function"},
              {"function",
               QJsonObject{{"name", p.toolCall.name},
                           {"arguments",
                            QString::fromUtf8(QJsonDocument(p.toolCall.input).toJson(
                                QJsonDocument::Compact))}}}});
      }
      QJsonObject msg{{"role", "assistant"}};
      if (!text.isEmpty()) msg.insert("content", text);
      if (!toolCalls.isEmpty()) msg.insert("tool_calls", toolCalls);
      if (!text.isEmpty() || !toolCalls.isEmpty()) messages.append(msg);
    } else {
      bool toolResult = false;
      for (const MessagePart& p : m.parts) {
        if (p.kind == MessagePart::ToolResult) {
          toolResult = true;
          const QString content = jsonToQs(p.toolResult.output);
          messages.append(QJsonObject{{"role", "tool"},
                                      {"tool_call_id", p.toolResult.toolCallId},
                                      {"content", content}});
        }
      }
      if (toolResult) continue;
      if (vision) {
        QJsonArray content;
        bool hasImage = false;
        for (const MessagePart& p : m.parts) {
          if (p.kind == MessagePart::Text)
            content.append(QJsonObject{{"type", "text"}, {"text", p.text.text}});
          if (p.kind == MessagePart::File && !p.file.data.isEmpty()) {
            QString url = p.file.data.startsWith("data:")
                              ? QString::fromLatin1(p.file.data)
                              : "data:" +
                                    (p.file.mime.isEmpty() ? "application/octet-stream" : p.file.mime) +
                                    ";base64," + QString::fromLatin1(p.file.data.toBase64());
            content.append(
                QJsonObject{{"type", "image_url"}, {"image_url", QJsonObject{{"url", url}}}});
            hasImage = true;
          }
        }
        if (hasImage && !content.isEmpty())
          messages.append(QJsonObject{{"role", "user"}, {"content", content}});
        else {
          const QString t = m.plainText();
          if (!t.isEmpty()) messages.append(QJsonObject{{"role", "user"}, {"content", t}});
        }
      } else {
        const QString t = m.plainText();
        if (!t.isEmpty()) messages.append(QJsonObject{{"role", "user"}, {"content", t}});
      }
    }
  }
  body.insert("messages", messages);
  if (!req.tools.isEmpty()) body.insert("tools", openAiTools(req));
  const bool reasoningModel =
      req.model.startsWith("o1") || req.model.startsWith("o3") || req.model.startsWith("o4") ||
      req.model.startsWith("gpt-5") || req.model.contains("reasoning") ||
      req.model.startsWith("deepseek-r1") || req.model.startsWith("qwen3");
  if (!reasoningModel) body.insert("temperature", req.temperature);
  if (req.provider == "openai" || req.provider == "opencode")
    body.insert("max_completion_tokens", req.maxTokens);
  else
    body.insert("max_tokens", req.maxTokens);
  if (req.thinking && reasoningModel) body.insert("reasoning_effort", "high");
  return body;
}

static QJsonObject buildGemini(const ChatRequest& req) {
  QJsonObject body;
  if (!req.system.isEmpty())
    body.insert("systemInstruction",
                QJsonObject{{"parts", QJsonArray{QJsonObject{{"text", req.system}}}}});
  QJsonArray contents;
  const bool vision = findModel(req.provider, req.model).supportsVision;
  for (const ChatMessage& m : req.messages) {
    const QString role = m.role == "assistant" ? "model" : "user";
    QJsonArray parts;
    if (m.role == "assistant") {
      for (const MessagePart& p : m.parts) {
        if (p.kind == MessagePart::Text && !p.text.text.isEmpty())
          parts.append(QJsonObject{{"text", p.text.text}});
        if (p.kind == MessagePart::ToolCall) {
          QJsonObject fc;
          fc.insert("name", p.toolCall.name);
          fc.insert("args", p.toolCall.input);
          QJsonObject call;
          call.insert("functionCall", fc);
          parts.append(call);
        }
      }
    } else {
      bool toolResult = false;
      for (const MessagePart& p : m.parts) {
        if (p.kind == MessagePart::ToolResult) {
          toolResult = true;
          QJsonObject response;
          if (p.toolResult.output.isObject())
            response = p.toolResult.output.toObject();
          else
            response = QJsonObject{{"result", p.toolResult.output.toString()}};
          QJsonObject resp;
          resp.insert("name", p.toolResult.toolName.isEmpty() ? QStringLiteral("tool")
                                                              : p.toolResult.toolName);
          resp.insert("response", QJsonObject{{"content", response}});
          QJsonObject wrapper;
          wrapper.insert("functionResponse", resp);
          parts.append(wrapper);
        }
      }
      if (!toolResult) {
        for (const MessagePart& p : m.parts) {
          if (p.kind == MessagePart::Text && !p.text.text.isEmpty())
            parts.append(QJsonObject{{"text", p.text.text}});
          if (p.kind == MessagePart::File && vision && !p.file.data.isEmpty()) {
            QByteArray b64 = p.file.data;
            if (p.file.data.startsWith("data:")) {
              const int comma = p.file.data.indexOf(',');
              b64 = p.file.data.mid(comma + 1);
            } else {
              b64 = p.file.data.toBase64();
            }
            QJsonObject inlineData;
            inlineData.insert("mimeType", p.file.mime.isEmpty()
                                              ? QStringLiteral("application/octet-stream")
                                              : p.file.mime);
            inlineData.insert("data", QString::fromLatin1(b64));
            QJsonObject wrapper;
            wrapper.insert("inlineData", inlineData);
            parts.append(wrapper);
          }
        }
      }
    }
    if (parts.isEmpty()) continue;
    contents.append(QJsonObject{{"role", role}, {"parts", parts}});
  }
  body.insert("contents", contents);
  if (!req.tools.isEmpty()) {
    QJsonArray decls;
    for (const auto& t : req.tools) {
      QJsonObject params = t.parameters;
      params.remove("additionalProperties");
      decls.append(QJsonObject{{"name", t.name},
                               {"description", t.description},
                               {"parameters", params}});
    }
    body.insert("tools", QJsonArray{QJsonObject{{"functionDeclarations", decls}}});
  }
  QJsonObject gen{{"maxOutputTokens", req.maxTokens}, {"temperature", req.temperature}};
  if (req.thinking && modelSupportsThinking(req.provider, req.model))
    gen.insert("thinkingConfig", QJsonObject{{"thinkingBudget", 8192}, {"includeThoughts", true}});
  body.insert("generationConfig", gen);
  return body;
}

struct PendingTool {
  QString id;
  QString name;
  QString args;
};

static LlmResponse streamOpenAi(const ChatRequest& req, const QString& url, const QString& key,
                                TextSink onText, TextSink onReasoning, std::atomic<bool>* abort) {
  LlmResponse out;
  QNetworkAccessManager nam;
  QNetworkRequest r{QUrl(url)};
  r.setTransferTimeout(600000);
  r.setRawHeader("Content-Type", "application/json");
  r.setRawHeader("Accept", "text/event-stream");
  if (!key.isEmpty()) r.setRawHeader("Authorization", (QStringLiteral("Bearer ") + key).toUtf8());
  QNetworkReply* reply = nam.post(r, QJsonDocument(buildOpenAi(req)).toJson());
  QEventLoop loop;
  QObject::connect(reply, &QNetworkReply::errorOccurred, &loop, &QEventLoop::quit);
  QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);

  QHash<int, PendingTool> tools;
  QByteArray buffer;
  bool done = false;

  auto processEvent = [&](const QByteArray& rawEvent) {
    QByteArray data;
    for (const QByteArray& line : rawEvent.split('\n')) {
      const QByteArray t = line.trimmed();
      if (t.startsWith("data:")) data += t.mid(5);
      else if (!t.startsWith(':') && !t.isEmpty() && !t.startsWith("event:")) data += t;
    }
    data = data.trimmed();
    if (data.isEmpty()) return;
    if (data == "[DONE]") {
      done = true;
      return;
    }
    const QJsonObject o = QJsonDocument::fromJson(data).object();
    if (o.contains("error")) {
      out.error = o.value("error").toObject().value("message").toString(
          o.value("error").toString());
      done = true;
      return;
    }
    const QJsonArray choices = o.value("choices").toArray();
    const QJsonObject choice0 =
        choices.isEmpty() ? QJsonObject{} : choices.at(0).toObject();
    const QJsonObject delta = choice0.value("delta").toObject();
    const QString content = delta.value("content").toString();
    if (!content.isEmpty()) {
      out.text += content;
      onText(content);
    }
    const QString reasoning =
        delta.value("reasoning_content").toString(delta.value("reasoning").toString());
    if (!reasoning.isEmpty()) {
      out.reasoning += reasoning;
      onReasoning(reasoning);
    }
    for (const QJsonValue& tv : delta.value("tool_calls").toArray()) {
      const QJsonObject to = tv.toObject();
      const int idx = int(tv.toObject().value("index").toDouble(0));
      PendingTool& pt = tools[idx];
      if (to.contains("id") && !to.value("id").toString().isEmpty())
        pt.id = to.value("id").toString();
      const QJsonObject fn = to.value("function").toObject();
      if (!fn.value("name").toString().isEmpty()) pt.name = fn.value("name").toString();
      pt.args += fn.value("arguments").toString();
    }
    const QString finish = choice0.value("finish_reason").toString();
    if (finish == "tool_calls" || !tools.isEmpty() && finish == "stop") done = true;
    if (finish == "stop" && tools.isEmpty()) done = true;
    if (finish == "length") done = true;
  };

  auto pump = [&] {
    buffer += reply->readAll();
    int idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const QByteArray ev = buffer.left(idx);
      buffer.remove(0, idx + 2);
      processEvent(ev);
      if (done) break;
    }
  };

  QObject::connect(reply, &QNetworkReply::readyRead, &loop, [&] {
    pump();
    if (done) loop.quit();
  });
  QObject::connect(reply, &QNetworkReply::finished, &loop, [&] {
    pump();
    loop.quit();
  });
  QTimer poll;
  poll.setInterval(100);
  if (abort) {
    QObject::connect(&poll, &QTimer::timeout, &loop, [&] {
      if (abort->load()) {
        reply->abort();
        loop.quit();
      }
    });
    poll.start();
  }
  loop.exec();
  poll.stop();

  const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  if (status >= 400 && out.error.isEmpty())
    out.error = providerErrorMessage(req.provider, QString::fromUtf8(reply->readAll()), status);
  else if (reply->error() != QNetworkReply::NoError && reply->error() != QNetworkReply::OperationCanceledError &&
           out.error.isEmpty())
    out.error = providerErrorMessage(req.provider, reply->errorString(), status);
  reply->deleteLater();

  for (auto it = tools.begin(); it != tools.end(); ++it) {
    if (it->name.isEmpty()) continue;
    ToolCallPart tc;
    tc.id = it->id.isEmpty() ? ("call_" + newId(8)) : it->id;
    tc.name = it->name;
    const QByteArray args = it->args.trimmed().isEmpty() ? QByteArray("{}") : it->args.toUtf8();
    QJsonParseError err{};
    const QJsonDocument d = QJsonDocument::fromJson(args, &err);
    tc.input = err.error == QJsonParseError::NoError && d.isObject() ? d.object() : QJsonObject{};
    out.toolCalls.push_back(tc);
  }
  return out;
}

static LlmResponse streamAnthropic(const ChatRequest& req, const QString& url, const QString& key,
                                   TextSink onText, TextSink onReasoning, std::atomic<bool>* abort) {
  LlmResponse out;
  QNetworkAccessManager nam;
  QNetworkRequest r{QUrl(url)};
  r.setTransferTimeout(600000);
  r.setRawHeader("Content-Type", "application/json");
  r.setRawHeader("Accept", "text/event-stream");
  r.setRawHeader("x-api-key", key.toUtf8());
  r.setRawHeader("anthropic-version", "2023-06-01");
  QNetworkReply* reply = nam.post(r, QJsonDocument(buildAnthropic(req)).toJson());
  QEventLoop loop;
  QObject::connect(reply, &QNetworkReply::errorOccurred, &loop, &QEventLoop::quit);
  QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);

  QHash<int, PendingTool> tools;
  QByteArray buffer;
  bool done = false;

  auto processEvent = [&](const QByteArray& rawEvent) {
    QByteArray data;
    QString eventName;
    for (const QByteArray& line : rawEvent.split('\n')) {
      const QByteArray t = line.trimmed();
      if (t.startsWith("data:")) data += t.mid(5);
      else if (t.startsWith("event:")) eventName = QString::fromUtf8(t.mid(6)).trimmed();
    }
    data = data.trimmed();
    if (data.isEmpty()) return;
    const QJsonObject o = QJsonDocument::fromJson(data).object();
    if (o.contains("error")) {
      out.error = o.value("error").toObject().value("message").toString();
      done = true;
      return;
    }
    if (eventName.isEmpty()) eventName = o.value("type").toString();
    if (eventName == "content_block_start") {
      const QJsonObject block = o.value("content_block").toObject();
      const int index = int(o.value("index").toDouble());
      if (block.value("type").toString() == "tool_use") {
        PendingTool& pt = tools[index];
        pt.id = block.value("id").toString();
        pt.name = block.value("name").toString();
        const QByteArray preset = QJsonDocument(block.value("input").toObject()).toJson(
            QJsonDocument::Compact);
        if (preset != "{}") pt.args = preset;
      }
    } else if (eventName == "content_block_delta") {
      const QJsonObject delta = o.value("delta").toObject();
      const QString type = delta.value("type").toString();
      if (type == "text_delta") {
        const QString t = delta.value("text").toString();
        out.text += t;
        onText(t);
      } else if (type == "thinking_delta") {
        const QString t = delta.value("thinking").toString();
        out.reasoning += t;
        onReasoning(t);
      } else if (type == "input_json_delta") {
        const int index = int(o.value("index").toDouble());
        tools[index].args += delta.value("partial_json").toString();
      }
    } else if (eventName == "message_delta") {
      const QString stop = o.value("delta").toObject().value("stop_reason").toString();
      if (!stop.isEmpty()) done = stop != "null";
    } else if (eventName == "message_stop") {
      done = true;
    }
  };

  auto pump = [&] {
    buffer += reply->readAll();
    int idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const QByteArray ev = buffer.left(idx);
      buffer.remove(0, idx + 2);
      processEvent(ev);
      if (done) break;
    }
  };
  QObject::connect(reply, &QNetworkReply::readyRead, &loop, [&] {
    pump();
    if (done) loop.quit();
  });
  QObject::connect(reply, &QNetworkReply::finished, &loop, [&] {
    pump();
    loop.quit();
  });
  QTimer poll;
  poll.setInterval(100);
  if (abort) {
    QObject::connect(&poll, &QTimer::timeout, &loop, [&] {
      if (abort->load()) {
        reply->abort();
        loop.quit();
      }
    });
    poll.start();
  }
  loop.exec();
  poll.stop();

  const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  if (status >= 400 && out.error.isEmpty())
    out.error = providerErrorMessage(req.provider, QString::fromUtf8(reply->readAll()), status);
  else if (reply->error() != QNetworkReply::NoError && reply->error() != QNetworkReply::OperationCanceledError &&
           out.error.isEmpty())
    out.error = providerErrorMessage(req.provider, reply->errorString(), status);
  reply->deleteLater();

  for (auto it = tools.begin(); it != tools.end(); ++it) {
    if (it->name.isEmpty()) continue;
    ToolCallPart tc;
    tc.id = it->id.isEmpty() ? ("toolu_" + newId(8)) : it->id;
    tc.name = it->name;
    const QByteArray args = it->args.trimmed().isEmpty() ? QByteArray("{}") : it->args.toUtf8();
    QJsonParseError err{};
    const QJsonDocument d = QJsonDocument::fromJson(args, &err);
    tc.input = err.error == QJsonParseError::NoError && d.isObject() ? d.object() : QJsonObject{};
    out.toolCalls.push_back(tc);
  }
  return out;
}

static LlmResponse streamGemini(const ChatRequest& req, const QString& url, TextSink onText,
                                TextSink onReasoning, std::atomic<bool>* abort) {
  LlmResponse out;
  QNetworkAccessManager nam;
  QNetworkRequest r{QUrl(url)};
  r.setTransferTimeout(600000);
  r.setRawHeader("Content-Type", "application/json");
  QNetworkReply* reply = nam.post(r, QJsonDocument(buildGemini(req)).toJson());
  QEventLoop loop;
  QObject::connect(reply, &QNetworkReply::errorOccurred, &loop, &QEventLoop::quit);
  QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
  QByteArray buffer;
  bool done = false;
  int callIdx = 0;

  auto processEvent = [&](const QByteArray& rawEvent) {
    QByteArray data;
    for (const QByteArray& line : rawEvent.split('\n')) {
      const QByteArray t = line.trimmed();
      if (t.startsWith("data:")) data += t.mid(5);
    }
    data = data.trimmed();
    if (data.isEmpty()) return;
    const QJsonObject o = QJsonDocument::fromJson(data).object();
    if (o.contains("error")) {
      out.error = o.value("error").toObject().value("message").toString();
      done = true;
      return;
    }
    const QJsonArray candidates = o.value("candidates").toArray();
    const QJsonObject cand =
        candidates.isEmpty() ? QJsonObject{} : candidates.at(0).toObject();
    for (const QJsonValue& pv : cand.value("content").toObject().value("parts").toArray()) {
      const QJsonObject part = pv.toObject();
      const QString text = part.value("text").toString();
      if (!text.isEmpty()) {
        if (part.value("thought").toBool()) {
          out.reasoning += text;
          onReasoning(text);
        } else {
          out.text += text;
          onText(text);
        }
      }
      if (part.contains("functionCall")) {
        const QJsonObject fc = part.value("functionCall").toObject();
        ToolCallPart tc;
        tc.id = "gemini_call_" + QString::number(++callIdx);
        tc.name = fc.value("name").toString();
        tc.input = fc.value("args").toObject();
        out.toolCalls.push_back(tc);
      }
    }
    const QString finish = cand.value("finishReason").toString();
    if (!finish.isEmpty() && finish != "STOP" && finish != "MAX_TOKENS") done = true;
    if (finish == "STOP" || finish == "MAX_TOKENS") done = !out.toolCalls.isEmpty() || true;
  };

  auto pump = [&] {
    buffer += reply->readAll();
    int idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const QByteArray ev = buffer.left(idx);
      buffer.remove(0, idx + 2);
      processEvent(ev);
      if (done) break;
    }
    if (!done && buffer.contains('\n')) {
      processEvent(buffer);
      buffer.clear();
    }
  };
  QObject::connect(reply, &QNetworkReply::readyRead, &loop, [&] {
    pump();
    if (done) loop.quit();
  });
  QObject::connect(reply, &QNetworkReply::finished, &loop, [&] {
    pump();
    loop.quit();
  });
  QTimer poll;
  poll.setInterval(100);
  if (abort) {
    QObject::connect(&poll, &QTimer::timeout, &loop, [&] {
      if (abort->load()) {
        reply->abort();
        loop.quit();
      }
    });
    poll.start();
  }
  loop.exec();
  poll.stop();

  const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  if (status >= 400 && out.error.isEmpty())
    out.error = providerErrorMessage("google", QString::fromUtf8(reply->readAll()), status);
  reply->deleteLater();
  return out;
}

LlmResponse streamCompletion(const ChatRequest& req, TextSink onText, TextSink onReasoning,
                             std::atomic<bool>* abort) {
  const QString key = resolveApiKey(req.provider);
  const QString base = resolveBaseUrl(req.provider);
  ProviderProtocol proto = ProviderProtocol::OpenAI;
  const ProviderConfig pc = findProvider(req.provider);
  if (pc.isCustom)
    proto = pc.protocol;
  else if (req.provider == "anthropic")
    proto = ProviderProtocol::Anthropic;
  else if (req.provider == "google")
    proto = ProviderProtocol::Gemini;
  else if (req.provider == "opencode" && req.model.startsWith("claude-"))
    proto = ProviderProtocol::Anthropic;
  else if (req.provider == "opencode" && req.model.startsWith("gemini-"))
    proto = ProviderProtocol::Gemini;

  if (key.isEmpty() && pc.requiresKey) {
    LlmResponse r;
    r.error = "No API key configured for " + pc.name +
              ". Add one via the key button in the header.";
    return r;
  }

  try {
    if (proto == ProviderProtocol::Anthropic)
      return streamAnthropic(req, anthropicUrl(base), key, onText, onReasoning, abort);
    if (proto == ProviderProtocol::Gemini) {
      const QString url =
          base + "/models/" + req.model + ":streamGenerateContent?alt=sse&key=" + key;
      return streamGemini(req, url, onText, onReasoning, abort);
    }
    return streamOpenAi(req, base + "/chat/completions", key, onText, onReasoning, abort);
  } catch (const std::exception& e) {
    LlmResponse r;
    r.error = providerErrorMessage(req.provider, e.what(), 0);
    return r;
  }
}

}  // namespace omnia
