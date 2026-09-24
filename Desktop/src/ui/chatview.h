#pragma once

#include <QLabel>
#include <QPushButton>
#include <QScrollArea>
#include <QTextEdit>
#include <QVBoxLayout>

#include "core/display.h"
#include "core/types.h"

namespace omnia {

class ChatView : public QScrollArea {
  Q_OBJECT
 public:
  explicit ChatView(QWidget* parent = nullptr);
  void setDisplay(const DisplaySettings& d);
  void clear();
  void appendMessage(const ChatMessage& m);
  void showSuggestions(bool show);
  void beginAssistant();
  void appendAssistantText(const QString& delta);
  void appendAssistantReasoning(const QString& delta);
  void addToolCard(const QString& callId, const QString& name, const QJsonObject& input);
  void finishToolCard(const QString& callId, const QJsonValue& output);
  void finalizeAssistant(const ChatMessage& m);
  void scrollToEnd();
  void setSubchatOpen(bool open);
  void setFabEnabled(bool enabled);

 signals:
  void suggestionClicked(const QString& text);
  void openArtifactRequested(const QString& artifactId);
  void computerCardClicked();
  void subchatSeedRequested(const QString& text);
  void agentCardClicked(const QString& agentId);
  void subchatOpenRequested();

 protected:
  void contextMenuEvent(QContextMenuEvent* e) override;
  void resizeEvent(QResizeEvent* e) override;

 private:
  QWidget* container_;
  QVBoxLayout* layout_;
  DisplaySettings display_;
  QVector<SourcePart> sources_;
  QTextEdit* streamEdit_ = nullptr;
  QWidget* streamBubble_ = nullptr;
  QLabel* streamReasoning_ = nullptr;
  QTextEdit* streamReasoningEdit_ = nullptr;
  QHash<QString, QWidget*> toolCards_;
  QHash<QString, QJsonObject> toolInput_;
  QHash<QString, QString> toolNames_;
  QWidget* empty_;
  bool autoScroll_ = true;
  QPushButton* subchatFab_ = nullptr;
  bool fabEnabled_ = true;
  bool subchatOpen_ = false;

  bool isAtBottom() const;
  void positionFab();
  void rebuildSearchCard(QWidget* card, const QJsonObject& args, const QJsonObject& result);

  QWidget* buildMessage(const ChatMessage& m);
  QWidget* buildUserMessage(const ChatMessage& m);
  QTextEdit* makeMarkdown(const QString& md, bool* ok = nullptr);
  void fit(QTextEdit* edit);
  void applySources(QString* md) const;
  QString renderMarkdownSource(const QString& raw) const;
  QWidget* buildThinkingBlock(const QString& reasoning, bool streaming);
  QWidget* buildEmptyState();
};

}  // namespace omnia
