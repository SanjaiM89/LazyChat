#pragma once

#include <QFontDatabase>
#include <QSettings>

#include "types.h"

namespace omnia {

inline const QVector<QPair<QString, QString>>& displayFonts() {
  static const QVector<QPair<QString, QString>> fonts = {
      {"system", "System UI"},   {"inter", "Inter"},        {"arial", "Arial"},
      {"helvetica", "Helvetica"}, {"verdana", "Verdana"},   {"trebuchet", "Trebuchet MS"},
      {"georgia", "Georgia"},     {"times", "Times"},       {"garamond", "Garamond"},
      {"palatino", "Palatino"},   {"merriweather", "Merriweather"}, {"lora", "Lora"},
      {"courier", "Courier"},     {"jetbrains", "JetBrains Mono"},
  };
  return fonts;
}

inline QString displayFontFamily(const QString& key) {
  if (key == "system") return QFontDatabase::systemFont(QFontDatabase::GeneralFont).family();
  const QMap<QString, QString> map = {
      {"inter", "Inter"},
      {"arial", "Arial"},
      {"helvetica", "Helvetica"},
      {"verdana", "Verdana"},
      {"trebuchet", "Trebuchet MS"},
      {"georgia", "Georgia"},
      {"times", "Times New Roman"},
      {"garamond", "Garamond"},
      {"palatino", "Palatino Linotype"},
      {"merriweather", "Merriweather"},
      {"lora", "Lora"},
      {"courier", "Courier New"},
      {"jetbrains", "JetBrains Mono"},
  };
  return map.value(key, displayFonts().first().second);
}

inline DisplaySettings loadDisplay() {
  QSettings s;
  DisplaySettings d;
  d.font = s.value("display/font", "system").toString();
  d.fontSize = s.value("display/fontSize", 15).toInt();
  d.contentWidth = s.value("display/contentWidth", 780).toInt();
  d.fontSize = qBound(13, d.fontSize, 20);
  d.contentWidth = qBound(560, d.contentWidth, 1600);
  return d;
}

inline void saveDisplay(const DisplaySettings& d) {
  QSettings s;
  s.setValue("display/font", d.font);
  s.setValue("display/fontSize", d.fontSize);
  s.setValue("display/contentWidth", d.contentWidth);
}

inline int loadSubchatWidth() {
  QSettings s;
  return qBound(280, s.value("subchat/width", 400).toInt(), 720);
}

inline void saveSubchatWidth(int w) {
  QSettings s;
  s.setValue("subchat/width", qBound(280, w, 720));
}

inline Theme loadTheme() {
  QSettings s;
  const QString t = s.value("ui/theme", "dark").toString();
  if (t == "light") return Theme::Light;
  if (t == "system") return Theme::System;
  return Theme::Dark;
}

inline void saveTheme(Theme t) {
  QSettings s;
  s.setValue("ui/theme", t == Theme::Light ? "light" : t == Theme::System ? "system" : "dark");
}

inline ChatSettings loadChatSettings() {
  QSettings s;
  return ChatSettings::fromJson(QJsonObject::fromVariantMap(s.value("chat/settings").toMap()));
}

inline void saveChatSettings(const ChatSettings& cs) {
  QSettings s;
  s.setValue("chat/settings", cs.toJson().toVariantMap());
}

}  // namespace omnia
