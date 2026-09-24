#pragma once

#include <QComboBox>
#include <QDialog>
#include <QLineEdit>
#include <QListWidget>
#include <QPlainTextEdit>
#include <QSpinBox>

#include "core/datastore.h"
#include "core/types.h"

namespace omnia {

class ApiKeysDialog : public QDialog {
  Q_OBJECT
 public:
  explicit ApiKeysDialog(QWidget* parent = nullptr);

 private:
  void load();
  void saveCurrent();
  QLineEdit* edit_;
  QListWidget* list_;
  QString currentProvider_;
};

class DisplaySettingsDialog : public QDialog {
  Q_OBJECT
 public:
  explicit DisplaySettingsDialog(QWidget* parent = nullptr);

 private:
  QComboBox* fontBox_;
  QSpinBox* sizeSpin_;
  QSpinBox* widthSpin_;
};

class SkillsDialog : public QDialog {
  Q_OBJECT
 public:
  explicit SkillsDialog(QWidget* parent = nullptr);

 private:
  void load();
  void add();
  void removeSelected();
  QListWidget* list_;
  QLineEdit* name_;
  QLineEdit* desc_;
  QPlainTextEdit* prompt_;
};

class ConnectionsDialog : public QDialog {
  Q_OBJECT
 public:
  explicit ConnectionsDialog(QWidget* parent = nullptr);

 private:
  void load();
  void add();
  void removeSelected();
  void toggleEnabled(QListWidgetItem* item);
  QListWidget* list_;
  QLineEdit* name_;
  QLineEdit* cmd_;
  QLineEdit* args_;
  QLineEdit* url_;
};

class SearchProvidersDialog : public QDialog {
  Q_OBJECT
 public:
  explicit SearchProvidersDialog(QWidget* parent = nullptr);

 private:
  void load();
  void add();
  void removeSelected();
  QListWidget* list_;
  QLineEdit* name_;
  QLineEdit* kind_;
  QLineEdit* key_;
  QLineEdit* url_;
};

class ManageModelsDialog : public QDialog {
  Q_OBJECT
 public:
  explicit ManageModelsDialog(QWidget* parent = nullptr);

 private:
  void load();
  void addModel();
  void removeModel();
  void renameModel();
  QComboBox* providerBox_;
  QListWidget* modelList_;
  QLineEdit* idEdit_;
  QLineEdit* nameEdit_;
};

class CustomProviderDialog : public QDialog {
  Q_OBJECT
 public:
  explicit CustomProviderDialog(QWidget* parent = nullptr);
  const CustomProviderRecord& record() const { return rec_; }

 private:
  void accept() override;
  CustomProviderRecord rec_;
  QLineEdit *name_, *baseUrl_, *apiKey_, *models_;
  QComboBox* protocol_;
};

}  // namespace omnia
