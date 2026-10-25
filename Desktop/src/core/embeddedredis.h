#pragma once

#include <QObject>
#include <QProcess>
#include <QString>

namespace omnia {

class EmbeddedRedis : public QObject {
  Q_OBJECT
 public:
  explicit EmbeddedRedis(QObject* parent = nullptr);
  ~EmbeddedRedis() override;

  bool start(int port = 6379);
  void stop();
  bool isRunning() const;
  int port() const { return port_; }

 private:
  QProcess* process_ = nullptr;
  int port_ = 6379;
};

}  // namespace omnia
