#pragma once

#include <QFrame>
#include <QLabel>
#include <QListWidget>
#include <QPushButton>
#include <QVBoxLayout>

#include "core/types.h"

namespace omnia {

class Sidebar : public QFrame {
  Q_OBJECT
 public:
  explicit Sidebar(QWidget* parent = nullptr);
  void setConversations(const QVector<Conversation>& conversations, const QString& activeId);
  void setRunConversation(const QString& conversationId);
  void setModelSubtitle(const QString& text);

 signals:
  void conversationSelected(const QString& id);
  void newChatRequested();
  void deleteConversationRequested(const QString& id);
  void openSkills();
  void openConnections();
  void openSearchProviders();

 protected:
  bool eventFilter(QObject* watched, QEvent* e) override;

 private:
  QListWidget* list_;
  QLabel* subtitle_;
  QLabel* emptyLabel_;
  QString activeId_;
  QString runCid_;
};

}  // namespace omnia
