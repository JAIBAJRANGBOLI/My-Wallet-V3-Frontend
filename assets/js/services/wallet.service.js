'use strict';

// MyWallet hacks

// Don't allow it to play sound
function playSound(id) {}

angular
  .module('walletServices', [])
  .factory('Wallet', Wallet);

Wallet.$inject = ['$http', '$window', '$timeout', 'Alerts', 'MyWallet', 'MyBlockchainApi', 'MyBlockchainSettings', 'MyWalletStore', 'MyWalletPayment', 'MyWalletTokenEndpoints', '$rootScope', 'ngAudio', '$cookies', '$translate', '$filter', '$state', '$q', 'bcPhoneNumber', 'languages', 'currency'];

function Wallet($http, $window, $timeout, Alerts, MyWallet, MyBlockchainApi, MyBlockchainSettings, MyWalletStore, MyWalletPayment, MyWalletTokenEndpoints, $rootScope, ngAudio, $cookies, $translate, $filter, $state, $q, bcPhoneNumber, languages, currency) {
  const wallet = {
    goal: {
      auth: false
    },
    status: {
      isLoggedIn: false,
      didUpgradeToHd: null,
      didInitializeHD: false,
      didLoadSettings: false,
      didLoadTransactions: false,
      didLoadBalances: false,
      didConfirmRecoveryPhrase: false
    },
    settings: {
      currency: null,
      displayCurrency: null,
      language: null,
      btcCurrency: null,
      needs2FA: null,
      twoFactorMethod: null,
      feePerKB: null,
      handleBitcoinLinks: false,
      blockTOR: null,
      rememberTwoFactor: null,
      secondPassword: null,
      ipWhitelist: null,
      apiAccess: null,
      restrictToWhitelist: null,
      loggingLevel: null
    },
    user: {
      current_ip: null,
      email: null,
      mobile: null,
      passwordHint: '',
      internationalMobileNumber: null
    }
  };
  wallet.fiatHistoricalConversionCache = {};
  wallet.conversions = {};
  wallet.paymentRequests = [];
  wallet.my = MyWallet;
  wallet.settings_api = MyBlockchainSettings;
  wallet.store = MyWalletStore;

  wallet.api = MyBlockchainApi;
  const customRootURL = $rootScope.rootURL;
  if(customRootURL) {
    wallet.api.setRootURL(customRootURL);
  } else {
    wallet.api.setRootURL("/");
  }
  if($rootScope.rootURL === undefined) {
    $rootScope.rootURL = "/";
  }

  wallet.payment = MyWalletPayment;
  wallet.tokenEndpoints = MyWalletTokenEndpoints;
  wallet.transactions = [];

  wallet.api_code = '1770d5d9-bcea-4d28-ad21-6cbd5be018a8';
  wallet.store.setAPICode(wallet.api_code);

  wallet.login = (uid, password, two_factor_code, needsTwoFactorCallback, successCallback, errorCallback) => {
    let didLogin = () => {
      wallet.status.isLoggedIn = true;
      wallet.status.didUpgradeToHd = wallet.my.wallet.isUpgradedToHD;
      if (wallet.my.wallet.isUpgradedToHD) {
        wallet.status.didConfirmRecoveryPhrase = wallet.my.wallet.hdwallet.isMnemonicVerified;
      }
      wallet.user.uid = uid;
      wallet.settings.secondPassword = wallet.my.wallet.isDoubleEncrypted;
      wallet.settings.pbkdf2 = wallet.my.wallet.pbkdf2_iterations;
      wallet.settings.logoutTimeMinutes = wallet.my.wallet.logoutTime / 60000;
      if (wallet.my.wallet.isUpgradedToHD && !wallet.status.didInitializeHD) {
        wallet.status.didInitializeHD = true;
      }
      wallet.settings_api.get_account_info((result) => {
        $window.name = 'blockchain-' + result.guid;
        wallet.settings.ipWhitelist = result.ip_lock || '';
        wallet.settings.restrictToWhitelist = result.ip_lock_on;
        wallet.settings.apiAccess = result.is_api_access_enabled;
        wallet.settings.rememberTwoFactor = !result.never_save_auth_type;
        wallet.settings.needs2FA = result.auth_type !== 0;
        wallet.settings.twoFactorMethod = result.auth_type;
        wallet.settings.loggingLevel = result.logging_level;
        wallet.user.email = result.email;
        wallet.user.current_ip = result.my_ip;
        wallet.status.currentCountryCode = result.country_code;
        if (result.sms_number) {
          wallet.user.mobile = {
            country: result.sms_number.split(' ')[0],
            number: result.sms_number.split(' ')[1]
          };
          wallet.user.internationalMobileNumber = bcPhoneNumber.format(result.sms_number);
        } else {
          wallet.user.mobile = {
            country: '+' + result.dial_code,
            number: ''
          };
          wallet.user.internationalMobileNumber = '+' + result.dial_code;
        }
        wallet.settings.notifications = result.notifications_type && result.notifications_type.length > 0 && result.notifications_type.indexOf(1) > -1 && (result.notifications_on == 0 || result.notifications_on == 2);
        wallet.user.isEmailVerified = result.email_verified;
        wallet.user.isMobileVerified = result.sms_verified;
        wallet.user.passwordHint = result.password_hint1;
        wallet.setLanguage($filter('getByProperty')('code', result.language, languages));
        wallet.settings.currency = $filter('getByProperty')('code', result.currency, currency.currencies);
        wallet.settings.btcCurrency = $filter('getByProperty')('serverCode', result.btc_currency, currency.bitCurrencies);
        wallet.settings.displayCurrency = wallet.settings.btcCurrency;
        wallet.settings.feePerKB = wallet.my.wallet.fee_per_kb;
        wallet.settings.blockTOR = !!result.block_tor_ips;
        wallet.status.didLoadSettings = true;
        if (wallet.my.wallet.isUpgradedToHD) {
          let didFetchTransactions = () => {
            console.log('%cStop!', 'color:white; background:red; font-size: 16pt');
            console.log('%cThis browser feature is intended for developers. If someone told you to copy-paste something here, it is a scam and will give them access to your money!', 'font-size: 14pt');
            wallet.status.didLoadBalances = true;
            wallet.updateTransactions();
          };
          wallet.my.wallet.getHistory().then(didFetchTransactions);
        }
        wallet.applyIfNeeded();
      });
      if (successCallback != null) {
        successCallback();
      }
      wallet.applyIfNeeded();
    };

    let needsTwoFactorCode = (method) => {
      Alerts.displayWarning('Please enter your 2FA code');
      wallet.settings.needs2FA = true;
      // 2: Email
      // 3: Yubikey
      // 4: Google Authenticator
      // 5: SMS

      needsTwoFactorCallback();

      wallet.settings.twoFactorMethod = method;
      wallet.applyIfNeeded();
    };

    let wrongTwoFactorCode = (message) => {
      errorCallback('twoFactor', message);
      wallet.applyIfNeeded();
    };

    let loginError = (error) => {
      console.log(error);
      if (error.indexOf('Unknown Wallet Identifier') > -1) {
        errorCallback('uid', error);
      } else if (error.indexOf('password') > -1) {
        errorCallback('password', error);
      } else {
        Alerts.displayError(error, true);
        errorCallback();
      }
      wallet.applyIfNeeded();
    };
    if (two_factor_code != null && two_factor_code !== '') {
      wallet.settings.needs2FA = true;
    } else {
      two_factor_code = null;
    }

    let authorizationProvided = () => {
      wallet.goal.auth = true;
      wallet.applyIfNeeded();
    };

    let authorizationRequired = (callback) => {
      callback(authorizationProvided());
      Alerts.displayWarning('Please check your email to approve this login attempt.', true);
      wallet.applyIfNeeded();
    };

    $window.root = 'https://blockchain.info/';
    wallet.my.login(
      uid,
      null, // sharedKey
      password,
      two_factor_code,
      didLogin,
      needsTwoFactorCode,
      wrongTwoFactorCode,
      authorizationRequired,
      loginError,
      () => {}, // fetchSuccess
      () => {}, // decryptSucces
      () => {} // buildHDSucces
    );
    currency.fetchExchangeRate();
  };

  wallet.upgrade = (successCallback, cancelSecondPasswordCallback) => {
    let success = () => {
      wallet.status.didUpgradeToHd = true;
      wallet.status.didInitializeHD = true;
      wallet.my.wallet.getHistory().then(() => {
        wallet.status.didLoadBalances = true;
        wallet.updateTransactions();
      });
      successCallback();
      wallet.applyIfNeeded();
    };

    let error = () => {
      wallet.store.enableLogout();
      wallet.store.setIsSynchronizedWithServer(true);
      $window.location.reload();
    };

    let proceed = (password) => {
      $translate('FIRST_ACCOUNT_NAME').then((translation) => {
        wallet.my.wallet.newHDWallet(translation, password, success, error);
      });
    };
    wallet.askForSecondPasswordIfNeeded()
      .then(proceed).catch(cancelSecondPasswordCallback);
  };

  wallet.legacyAddresses = () => wallet.my.wallet.keys;

  let hdAddresses = {};
  wallet.hdAddresses = (accountIdx) => {
    return (refresh) => {
      refresh = refresh || null;
      if (refresh || hdAddresses[accountIdx] == null) {
        let account = wallet.accounts()[accountIdx];
        hdAddresses[accountIdx] = account.receivingAddressesLabels.map((address) => {
          return {
              index: address.index,
              label: address.label,
              address: account.receiveAddressAtIndex(address.index),
              account: account
            }
          }
        );
      }
      return hdAddresses[accountIdx];
    };
  };

  wallet.addAddressForAccount = (account, successCallback, errorCallback) => {
    let success = () => {
      wallet.hdAddresses(account.index)(true);
      successCallback();
      wallet.applyIfNeeded();
    };
    $translate('DEFAULT_NEW_ADDRESS_LABEL').then((translation) => {
      account.setLabelForReceivingAddress(account.receiveIndex, translation)
        .then(success).catch(errorCallback);
    });
  };

  wallet.resendTwoFactorSms = (uid, successCallback, errorCallback) => {
    let success = () => {
      $translate('RESENT_2FA_SMS').then(Alerts.displaySuccess);
      successCallback();
      wallet.applyIfNeeded();
    };
    let error = (e) => {
      $translate('RESENT_2FA_SMS_FAILED').then(Alerts.displayError);
      errorCallback();
      wallet.applyIfNeeded();
    };
    wallet.my.resendTwoFactorSms(uid, success, error);
  };

  wallet.create = (password, email, currency, language, success_callback) => {
    let success = (uid) => {
      Alerts.displaySuccess('Wallet created with identifier: ' + uid, true);
      wallet.status.firstTime = true;

      let loginSuccess = () => {
        success_callback(uid);
      };

      let loginError = (error) => {
        console.log(error);
        Alerts.displayError('Unable to login to new wallet');
      };

      wallet.login(uid, password, null, null, loginSuccess, loginError);
    };

    let error = (error) => {
      if (error.message !== void 0) Alerts.displayError(error.message);
      else Alerts.displayError(error);
    };

    let currency_code = currency && currency.code || 'USD';
    let language_code = language && language.code || 'en';

    $translate('FIRST_ACCOUNT_NAME')
      .then((translation) => {
        wallet.my.createNewWallet(
          email,
          password,
          translation,
          language_code,
          currency_code,
          success,
          error
        );
      });
  };

  wallet.askForSecondPasswordIfNeeded = () => {
    let defer = $q.defer();
    if (wallet.my.wallet.isDoubleEncrypted) {
      $rootScope.$broadcast('requireSecondPassword', defer);
    } else {
      defer.resolve(null);
    }
    return defer.promise;
  };

  wallet.saveActivity = () => {
    // TYPES: ['transactions', 'security', 'settings', 'accounts']
    $rootScope.$broadcast('updateActivityFeed');
  };

  let addressBook = void 0;
  wallet.addressBook = (refresh) => {
    let myAddressBook = wallet.my.wallet.addressBook;
    if (addressBook === void 0 || refresh) {
      addressBook = Object.keys(myAddressBook).map((key) => {
        return {
          address: key,
          label: myAddressBook[key]
        };
      });
    }
    return addressBook;
  };

  wallet.removeAddressBookEntry = (address) => {
    wallet.my.wallet.removeAddressBookEntry(address.address);
    wallet.addressBook(true); // Refreshes address book
  };

  wallet.createAccount = (label, successCallback, errorCallback, cancelCallback) => {
    let proceed = (password) => {
      let newAccount = wallet.my.wallet.newAccount(label, password);
      wallet.my.wallet.getHistory().then(wallet.updateTransactions);
      successCallback && successCallback();
    };
    wallet.askForSecondPasswordIfNeeded()
      .then(proceed).catch(cancelCallback);
  };

  wallet.renameAccount = (account, name, successCallback, errorCallback) => {
    account.label = name;
    successCallback();
  };

  wallet.fetchMoreTransactions = (where, successCallback, errorCallback, allTransactionsLoadedCallback) => {
    let success = (res) => {
      wallet.appendTransactions(res);
      successCallback();
      wallet.applyIfNeeded();
    };

    let error = () => {
      errorCallback();
      wallet.applyIfNeeded();
    };

    let allTransactionsLoaded = () => {
      allTransactionsLoadedCallback && allTransactionsLoadedCallback();
      wallet.applyIfNeeded();
    };

    if (where === '') {
      wallet.my.fetchMoreTransactionsForAll(success, error, allTransactionsLoaded);
    } else if (where === 'imported') {
      wallet.my.fetchMoreTransactionsForLegacyAddresses(success, error, allTransactionsLoaded);
    } else {
      wallet.my.fetchMoreTransactionsForAccount(parseInt(where), success, error, allTransactionsLoaded);
    }
  };

  wallet.changeLegacyAddressLabel = (address, label, successCallback, errorCallback) => {
    address.label = label;
    successCallback();
  };

  wallet.changeHDAddressLabel = (accountIdx, index, label, successCallback, errorCallback) => {
    let success = () => {
      wallet.hdAddresses(accountIdx)(true);
      successCallback();
      wallet.applyIfNeeded();
    };

    let error = (msg) => {
      errorCallback(msg);
      wallet.applyIfNeeded();
    };

    let account = wallet.accounts()[parseInt(accountIdx)];
    account.setLabelForReceivingAddress(index, label)
      .then(success).catch(error);
  };

  wallet.logout = () => {
    wallet.didLogoutByChoice = true;
    $window.name = 'blockchain';
    wallet.my.logout(true);
  };

  wallet.makePairingCode = (successCallback, errorCallback) => {
    let success = (code) => {
      successCallback(code);
      wallet.applyIfNeeded();
    };

    let error = () => {
      errorCallback();
      wallet.applyIfNeeded();
    };

    wallet.my.makePairingCode(success, error);
  };

  wallet.confirmRecoveryPhrase = () => {
    wallet.my.wallet.hdwallet.verifyMnemonic();
    wallet.status.didConfirmRecoveryPhrase = true;
  };

  wallet.isCorrectMainPassword = (candidate) =>
    wallet.store.isCorrectMainPassword(candidate);

  wallet.changePassword = (newPassword, successCallback, errorCallback) => {
    wallet.store.changePassword(newPassword, (() => {
      $translate('CHANGE_PASSWORD_SUCCESS').then((translation) => {
        Alerts.displaySuccess(translation);
        successCallback(translation);
      });
    }), () => {
      $translate('CHANGE_PASSWORD_FAILED').then((translation) => {
        Alerts.displayError(translation);
        errorCallback(translation);
      });
    });
  };

  wallet.setIPWhitelist = (ips, successCallback, errorCallback) => {
    let success = () => {
      wallet.settings.ipWhitelist = ips;
      successCallback();
      wallet.applyIfNeeded();
    };

    let error = () => {
      errorCallback();
      wallet.applyIfNeeded();
    };

    wallet.settings_api.update_IP_lock(ips, success, error);
  };

  wallet.resendEmailConfirmation = (successCallback, errorCallback) => {
    let success = () => {
      successCallback();
      wallet.applyIfNeeded();
    };

    let error = () => {
      errorCallback();
      wallet.applyIfNeeded();
    };

    wallet.settings_api.resendEmailConfirmation(wallet.user.email, success, error);
  };
  wallet.setPbkdf2Iterations = (n, successCallback, errorCallback, cancelCallback) => {
    let proceed = (password) => {
      wallet.my.wallet.changePbkdf2Iterations(parseInt(n), password);
      wallet.settings.pbkdf2 = wallet.my.wallet.pbkdf2_iterations;
      successCallback();
    };
    wallet.askForSecondPasswordIfNeeded()
      .then(proceed).catch(cancelCallback);
  };
  wallet.setLoggingLevel = (level) => {
    wallet.settings_api.updateLoggingLevel(level, () => {
      wallet.settings.loggingLevel = level;
      wallet.saveActivity(4);
      wallet.applyIfNeeded();
    }, () => {
      Alerts.displayError('Failed to update logging level');
      wallet.applyIfNeeded();
    });
  };

  wallet.recommendedTransactionFee = (origin, amount) =>
    wallet.my.getBaseFee();

  wallet.toggleDisplayCurrency = () => {
    if (currency.isBitCurrency(wallet.settings.displayCurrency)) {
      wallet.settings.displayCurrency = wallet.settings.currency;
    } else {
      wallet.settings.displayCurrency = wallet.settings.btcCurrency;
    }
  };

  wallet.checkAndGetTransactionAmount = (amount, currency, success, error) => {
    amount = currency.convertToSatoshi(amount, currency);
    if (success == null || error == null) {
      console.error('Success and error callbacks are required');
      return;
    }
    return amount;
  };

  wallet.addAddressOrPrivateKey = (addressOrPrivateKey, needsBipPassphraseCallback, successCallback, errorCallback, cancel) => {
    let success = (address) => {
      successCallback(address);
      wallet.applyIfNeeded();
    };

    let proceed = (secondPassword='') => {
      let error = (message) => {
        if (message === 'needsBip38') {
          needsBipPassphraseCallback(proceedWithBip38);
        } else {
          errorCallback(message);
        }
        wallet.applyIfNeeded();
      };

      let proceedWithBip38 = (bipPassphrase) => {
        wallet.my.wallet.importLegacyAddress(addressOrPrivateKey, '', secondPassword, bipPassphrase).then(success, error);
      };

      let proceedWithoutBip38 = () => {
        wallet.my.wallet.importLegacyAddress(addressOrPrivateKey, '', secondPassword, '').then(success, error);
      };
      proceedWithoutBip38();
    };

    wallet.askForSecondPasswordIfNeeded()
      .then(proceed, cancel);
  };

  wallet.fetchBalanceForRedeemCode = (code) => {
    let defer = $q.defer();

    let success = (balance) => {
      defer.resolve(balance);
    };

    let error = (error) => {
      console.log('Could not retrieve balance');
      console.log(error);
      defer.reject();
    };
    wallet.my.getBalanceForRedeemCode(code, success, error);
    return defer.promise;
  };

  wallet.getAddressBookLabel = (address) =>
    wallet.my.wallet.getAddressBookLabel(address);

  wallet.getMnemonic = (successCallback, errorCallback, cancelCallback) => {
    let proceed = (password) => {
      let mnemonic = wallet.my.wallet.getMnemonic(password);
      successCallback(mnemonic);
    };
    wallet.askForSecondPasswordIfNeeded()
      .then(proceed).catch(cancelCallback);
  };

  wallet.importWithMnemonic = (mnemonic, bip39pass, successCallback, errorCallback, cancelCallback) => {
    let cancel = () => {
      cancelCallback();
    };

    let restore = (password) => {
      console.log('restoring...');
      wallet.transactions.splice(0, wallet.transactions.length);
      wallet.my.wallet.restoreHDWallet(mnemonic, bip39pass, password);
    };

    let update = () => {
      console.log('updating...');
      wallet.my.wallet.getHistory().then(wallet.updateTransactions);
      successCallback();
    };

    wallet.askForSecondPasswordIfNeeded()
      .then(restore).then(update).catch(cancel);
  };

  wallet.getDefaultAccountIndex = () => {
    if (wallet.my.wallet == null) {
      return 0;
    } else if (wallet.my.wallet.isUpgradedToHD) {
      return wallet.my.wallet.hdwallet.defaultAccountIndex;
    } else {
      return 0;
    }
  };

  wallet.getReceivingAddressForAccount = (idx) => {
    if (wallet.my.wallet.isUpgradedToHD) {
      return wallet.my.wallet.hdwallet.accounts[idx].receiveAddress;
    } else {
      return '';
    }
  };

  wallet.getReceivingAddressIndexForAccount = (idx) => {
    if (wallet.my.wallet.isUpgradedToHD) {
      return wallet.my.wallet.hdwallet.accounts[idx].receiveIndex;
    } else {
      return null;
    }
  };

  wallet.parsePaymentRequest = (url) => {
    let result = {
      address: null,
      amount: null,
      label: null,
      message: null
    };
    result.isValid = true;
    if (url.indexOf('bitcoin:') === 0) {
      let withoutPrefix = url.replace('bitcoin://', '').replace('bitcoin:', '');
      let qIndex = withoutPrefix.indexOf('?');
      if (qIndex !== -1) {
        result.address = withoutPrefix.substr(0, qIndex);
        let keys = withoutPrefix.substr(qIndex + 1).split('&');
        keys.forEach((item) => {
          var key, value;
          key = item.split('=')[0];
          value = item.split('=')[1];
          if (key === 'amount') {
            result.amount = currency.convertToSatoshi(parseFloat(value), currency.bitCurrencies[0]);
          } else if (result[key] !== void 0) {
            result[key] = value;
          }
        });
      } else {
        result.address = withoutPrefix;
      }
    } else if (wallet.my.isValidAddress(url)) {
      result.address = url;
    } else {
      result.isValid = false;
    }
    return result;
  };

  wallet.isSynchronizedWithServer = () =>
    wallet.store.isSynchronizedWithServer();

  window.onbeforeunload = (event) => {
    if (!wallet.isSynchronizedWithServer() && wallet.my.wallet.isEncryptionConsistent) {
      event.preventDefault();
      return 'There are unsaved changes. Are you sure?';
    }
  };

  wallet.isValidAddress = (address) => wallet.my.isValidAddress(address)

  wallet.archive = (address_or_account) => {
    wallet.saveActivity(3);
    address_or_account.archived = true;
    address_or_account.active = false;
  };

  wallet.unarchive = (address_or_account) => {
    wallet.saveActivity(3);
    address_or_account.archived = false;
    address_or_account.active = true;
  };

  wallet.deleteLegacyAddress = (address) => {
    wallet.saveActivity(3);
    wallet.my.wallet.deleteLegacyAddress(address);
  };

  wallet.accounts = () => {
    if (wallet.my.wallet.hdwallet != null) {
      return wallet.my.wallet.hdwallet.accounts;
    } else {
      return [];
    }
  };

  wallet.total = (accountIndex) => {
    if (wallet.my.wallet == null) return;
    switch (accountIndex) {
      case '':
        if (wallet.my.wallet.isUpgradedToHD) {
          return wallet.my.wallet.hdwallet.balanceActiveAccounts + wallet.my.wallet.balanceSpendableActiveLegacy;
        } else {
          return wallet.my.wallet.balanceSpendableActiveLegacy;
        }
        break;
      case 'imported':
        return wallet.my.wallet.balanceSpendableActiveLegacy;
      case void 0:
        if (wallet.my.wallet.isUpgradedToHD) {
          return wallet.my.wallet.hdwallet.balanceActiveAccounts + wallet.my.wallet.balanceSpendableActiveLegacy;
        } else {
          return wallet.my.wallet.balanceSpendableActiveLegacy;
        }
        break;
      default:
        let account = wallet.accounts()[parseInt(accountIndex)];
        if (account === null) {
          return null;
        } else {
          return account.balance;
        }
    }
  };

  wallet.updateTransactions = () => {
    for (let tx of wallet.store.getAllTransactions().reverse()) {
      let match = false;
      for (let candidate of wallet.transactions) {
        if (candidate.hash === tx.hash) {
          match = true;
          if (candidate.note == null) {
            candidate.note = wallet.my.wallet.getNote(tx.hash);
          }
          break;
        }
      }
      if (!match) {
        let transaction = angular.copy(tx);
        transaction.note = wallet.my.wallet.getNote(transaction.hash);
        wallet.transactions.unshift(transaction);
      }
    }
    wallet.status.didLoadTransactions = true;
    wallet.applyIfNeeded();
  };

  wallet.appendTransactions = (transactions, override) => {
    if (transactions == null || wallet.transactions == null) return;
    let results = [];
    for (let tx of transactions) {
      let match = false;
      for (let candidate of wallet.transactions) {
        if (candidate.hash === tx.hash) {
          if (override) {
            wallet.transactions.splice(wallet.transactions.splice(candidate));
          } else {
            match = true;
          }
          break;
        }
      }
      if (!match) {
        let transaction = angular.copy(tx);
        transaction.note = wallet.my.wallet.getNote(transaction.hash);
        results.push(wallet.transactions.push(transaction));
      } else {
        results.push(void 0);
      }
    }
    return results;
  };

  wallet.beep = () => {
    let sound = ngAudio.load('beep.wav');
    sound.play();
  };

  wallet.monitor = (event, data) => {
    if (event === 'on_tx' || event === 'on_block') {
      let before = wallet.transactions.length;
      wallet.updateTransactions();
      let numberOfTransactions = wallet.transactions.length;
      if (numberOfTransactions > before) {
        wallet.beep();
        if (wallet.transactions[0].result > 0 && !wallet.transactions[0].intraWallet) {
          $translate('JUST_RECEIVED_BITCOIN').then((translation) => {
            Alerts.displayReceivedBitcoin(translation);
          });
          wallet.saveActivity(0);
        }
      }
    } else if (event === 'error_restoring_wallet') {
    } else if (event === 'did_set_guid') {
    } else if (event === 'on_wallet_decrypt_finish') {
    } else if (event === 'hd_wallets_does_not_exist') {
      wallet.status.didUpgradeToHd = false;
      $timeout(() => {
        $rootScope.$broadcast('needsUpgradeToHD', 1000);
      });
    } else if (event === 'wallet not found') {
      $translate('WALLET_NOT_FOUND').then((translation) => {
        Alerts.displayError(translation);
      });
    } else if (event === 'ticker_updated' || event === 'did_set_latest_block') {
      wallet.applyIfNeeded();
    } else if (event === 'logging_out') {
      if (wallet.didLogoutByChoice) {
        $translate('LOGGED_OUT').then((translation) => {
          $cookies.put('alert-success', translation);
        });
      } else {
        $translate('LOGGED_OUT_AUTOMATICALLY').then((translation) => {
          $cookies.put('alert-warning', translation);
          wallet.applyIfNeeded();
        });
      }
      wallet.status.isLoggedIn = false;
      while (wallet.transactions.length > 0) {
        wallet.transactions.pop();
      }
      while (wallet.paymentRequests.length > 0) {
        wallet.paymentRequests.pop();
      }
      wallet.user.uid = '';
      wallet.password = '';
    } else if (event === 'ws_on_close' || event === 'ws_on_open') {
    } else if (event.type !== void 0) {
      if (event.type === 'error') {
        Alerts.displayError(event.msg);
        wallet.applyIfNeeded();
      } else if (event.type === 'success') {
        Alerts.displaySuccess(event.msg);
        wallet.applyIfNeeded();
      } else if (event.type === 'notice') {
        Alerts.displayWarning(event.msg);
        wallet.applyIfNeeded();
      } else {
      }
    } else {
    }
  };

  wallet.store.addEventListener((event, data) => {
    wallet.monitor(event, data);
  });

  let message = $cookies.get('alert-warning');
  if (message !== void 0 && message !== null) {
    Alerts.displayWarning(message, true);
    $cookies.remove('alert-warning');
  }
  message = $cookies.get('alert-success');
  if (message !== void 0 && message !== null) {
    Alerts.displaySuccess(message);
    $cookies.remove('alert-success');
  }

  wallet.setNote = (tx, text) => {
    wallet.my.wallet.setNote(tx.hash, text);
  };

  wallet.deleteNote = (tx) => {
    wallet.my.wallet.deleteNote(tx.hash);
  };

  wallet.setLogoutTime = (minutes, success, error) => {
    wallet.store.setLogoutTime(minutes * 60000);
    wallet.settings.logoutTimeMinutes = minutes;
    success();
  };

  wallet.getCurrency = () => wallet.my.getCurrency();

  wallet.setLanguage = (language) => {
    $translate.use(language.code);
    wallet.settings.language = language;
  };

  wallet.changeLanguage = (language) => {
    wallet.settings_api.change_language(language.code, (() => {}));
    wallet.setLanguage(language);
  };

  wallet.changeCurrency = (currency) => {
    wallet.settings_api.change_local_currency(currency.code);
    wallet.settings.currency = currency;
  };

  wallet.changeBTCCurrency = (btcCurrency) => {
    wallet.settings_api.change_btc_currency(btcCurrency.serverCode);
    wallet.settings.btcCurrency = btcCurrency;
  };

  wallet.changeEmail = (email, successCallback, errorCallback) => {
    wallet.settings_api.change_email(email, (() => {
      wallet.user.email = email;
      wallet.user.isEmailVerified = false;
      successCallback();
      wallet.applyIfNeeded();
    }), () => {
      $translate('CHANGE_EMAIL_FAILED').then((translation) => {
        Alerts.displayError(translation);
        wallet.applyIfNeeded();
      });
      errorCallback();
    });
  };
  wallet.enableNotifications = () => {
    let success = () => {
      wallet.settings.notifications = true;
      wallet.applyIfNeeded();
    };
    let error = () => {
      Alerts.displayError('Failed to enable notifications');
      wallet.applyIfNeeded();
    };
    wallet.my.wallet.enableNotifications(success, error);
  };

  wallet.disableNotifications = () => {
    let success = () => {
      wallet.settings.notifications = false;
      wallet.applyIfNeeded();
    };
    let error = () => {
      Alerts.displayError('Failed to disable notifications');
      wallet.applyIfNeeded();
    };
    wallet.my.wallet.disableNotifications(success, error);
  };

  wallet.setFeePerKB = (fee, successCallback, errorCallback) => {
    wallet.my.wallet.fee_per_kb = fee;
    wallet.settings.feePerKB = fee;
    successCallback();
  };

  wallet.getActivityLogs = (success) => {
    wallet.settings_api.getActivityLogs(success, () => {
      console.log('Failed to load activity logs');
    });
  };

  wallet.isEmailVerified = () => wallet.my.isEmailVerified;

  wallet.internationalPhoneNumber = (mobile) => {
    if (mobile == null) return null;
    return mobile.country + ' ' + mobile.number.replace(/^0*/, '');
  };

  wallet.changeMobile = (mobile, successCallback, errorCallback) => {
    wallet.settings_api.changeMobileNumber(wallet.internationalPhoneNumber(mobile), (() => {
      wallet.user.mobile = mobile;
      wallet.user.isMobileVerified = false;
      successCallback();
      wallet.applyIfNeeded();
    }), () => {
      $translate('CHANGE_MOBILE_FAILED').then((translation) => {
        Alerts.displayError(translation);
      });
      errorCallback();
      wallet.applyIfNeeded();
    });
  };

  wallet.verifyMobile = (code, successCallback, errorCallback) => {
    wallet.settings_api.verifyMobile(code, (() => {
      wallet.user.isMobileVerified = true;
      successCallback();
      wallet.applyIfNeeded();
    }), () => {
      $translate('VERIFY_MOBILE_FAILED').then((translation) => {
        errorCallback(translation);
      });
      wallet.applyIfNeeded();
    });
  };

  wallet.applyIfNeeded = () => {
    if (MyWallet.mockShouldReceiveNewTransaction === void 0) {
      $rootScope.$safeApply();
    }
  };

  wallet.changePasswordHint = (hint, successCallback, errorCallback) => {
    wallet.settings_api.update_password_hint1(hint, (() => {
      wallet.user.passwordHint = hint;
      successCallback();
      wallet.applyIfNeeded();
    }), (err) => {
      errorCallback(err);
      wallet.applyIfNeeded();
    });
  };

  wallet.isMobileVerified = () => wallet.my.isMobileVerified;

  wallet.disableSecondFactor = () => {
    wallet.settings_api.unsetTwoFactor(() => {
      wallet.settings.needs2FA = false;
      wallet.settings.twoFactorMethod = null;
      wallet.applyIfNeeded();
    }, () => {
      console.log('Failed');
      wallet.applyIfNeeded();
    });
  };

  wallet.setTwoFactorSMS = () => {
    wallet.settings_api.setTwoFactorSMS(() => {
      wallet.settings.needs2FA = true;
      wallet.settings.twoFactorMethod = 5;
      wallet.applyIfNeeded();
    }, () => {
      console.log('Failed');
      wallet.applyIfNeeded();
    });
  };

  wallet.setTwoFactorEmail = () => {
    wallet.settings_api.setTwoFactorEmail(() => {
      wallet.settings.needs2FA = true;
      wallet.settings.twoFactorMethod = 2;
      wallet.applyIfNeeded();
    }, () => {
      console.log('Failed');
      wallet.applyIfNeeded();
    });
  };

  wallet.setTwoFactorYubiKey = (code, successCallback, errorCallback) => {
    wallet.settings_api.setTwoFactorYubiKey(code, () => {
      wallet.settings.needs2FA = true;
      wallet.settings.twoFactorMethod = 1;
      successCallback();
      wallet.applyIfNeeded();
    }, (error) => {
      console.log(error);
      errorCallback(error);
      wallet.applyIfNeeded();
    });
  };

  wallet.setTwoFactorGoogleAuthenticator = () => {
    wallet.settings_api.setTwoFactorGoogleAuthenticator((secret) => {
      wallet.settings.googleAuthenticatorSecret = secret;
      wallet.applyIfNeeded();
    }, () => {
      console.log('Failed');
      wallet.applyIfNeeded();
    });
  };

  wallet.confirmTwoFactorGoogleAuthenticator = (code, successCallback, errorCallback) => {
    wallet.settings_api.confirmTwoFactorGoogleAuthenticator(code, () => {
      wallet.settings.needs2FA = true;
      wallet.settings.twoFactorMethod = 4;
      wallet.settings.googleAuthenticatorSecret = null;
      successCallback();
      wallet.applyIfNeeded();
    }, () => {
      errorCallback();
      wallet.applyIfNeeded();
    });
  };

  wallet.enableRememberTwoFactor = (successCallback, errorCallback) => {
    let success = () => {
      wallet.settings.rememberTwoFactor = true;
      successCallback();
      wallet.applyIfNeeded();
    };
    let error = () => {
      errorCallback();
      wallet.applyIfNeeded();
    };
    wallet.settings_api.toggleSave2FA(false, success, error);
  };

  wallet.disableRememberTwoFactor = (successCallback, errorCallback) => {
    let success = () => {
      wallet.settings.rememberTwoFactor = false;
      successCallback();
      wallet.applyIfNeeded();
    };
    let error = () => {
      errorCallback();
      wallet.applyIfNeeded();
    };
    wallet.settings_api.toggleSave2FA(true, success, error);
  };

  wallet.handleBitcoinLinks = () => {
    wallet.saveActivity(2);
    $window.navigator.registerProtocolHandler('bitcoin', $window.location.origin + '/#/open/%s', 'Blockchain');
  };

  wallet.enableBlockTOR = () => {
    wallet.settings_api.update_tor_ip_block(1, () => {
      wallet.settings.blockTOR = true;
      wallet.applyIfNeeded();
    }, () => {
      console.log('Failed');
      wallet.applyIfNeeded();
    });
  };

  wallet.disableBlockTOR = () => {
    wallet.settings_api.update_tor_ip_block(0, () => {
      wallet.settings.blockTOR = false;
      wallet.applyIfNeeded();
    }, () => {
      console.log('Failed');
      wallet.applyIfNeeded();
    });
  };

  wallet.enableRestrictToWhiteListedIPs = () => {
    wallet.settings_api.update_IP_lock_on(true, () => {
      wallet.settings.restrictToWhitelist = true;
      wallet.saveActivity(2);
      wallet.applyIfNeeded();
    }, () => {
      console.log('Failed');
      wallet.applyIfNeeded();
    });
  };

  wallet.disableRestrictToWhiteListedIPs = () => {
    wallet.settings_api.update_IP_lock_on(false, () => {
      wallet.settings.restrictToWhitelist = false;
      wallet.saveActivity(2);
      wallet.applyIfNeeded();
    }, () => {
      console.log('Failed');
      wallet.applyIfNeeded();
    });
  };

  wallet.getTotalBalanceForActiveLegacyAddresses = () => {
    if (wallet.my.wallet == null) return;
    return wallet.my.wallet.balanceSpendableActiveLegacy;
  };

  wallet.setDefaultAccount = (account) => {
    wallet.my.wallet.hdwallet.defaultAccountIndex = account.index;
  };

  wallet.isDefaultAccount = (account) =>
    wallet.my.wallet.hdwallet.defaultAccountIndex === account.index;

  wallet.isValidBIP39Mnemonic = (mnemonic) =>
    wallet.my.isValidateBIP39Mnemonic(mnemonic);

  wallet.removeSecondPassword = (successCallback, errorCallback) => {
    let success = () => {
      Alerts.displaySuccess('Second password has been removed.');
      wallet.settings.secondPassword = false;
      successCallback();
    };
    let error = () => {
      $translate('SECOND_PASSWORD_REMOVE_ERR').then(Alerts.displayError);
      errorCallback();
    };
    let cancel = errorCallback;
    let decrypting = () => {
      console.log('Decrypting...');
    };
    let syncing = () => {
      console.log('Syncing...');
    };
    let proceed = (password) => {
      wallet.my.wallet.decrypt(password, success, error, decrypting, syncing);
    };
    wallet.askForSecondPasswordIfNeeded().then(proceed).catch(cancel);
  };

  wallet.validateSecondPassword = (password) =>
    wallet.my.wallet.validateSecondPassword(password);

  wallet.setSecondPassword = (password, successCallback) => {
    let success = () => {
      Alerts.displaySuccess('Second password set.');
      wallet.settings.secondPassword = true;
      successCallback();
    };
    let error = () => {
      Alerts.displayError('Second password cannot be set. Contact support.');
    };
    let encrypting = () => {
      console.log('Encrypting...');
    };
    let syncing = () => {
      console.log('Syncing...');
    };
    wallet.my.wallet.encrypt(password, success, error, encrypting, syncing);
  };

  wallet.verifyEmail = (token, successCallback, errorCallback) => {
    const success = (guid) => {
      wallet.user.isEmailVerified = true;
      successCallback(guid);
      wallet.applyIfNeeded();
    }

    const error = (message) => {
      console.log(message);
      errorCallback(message);
      wallet.applyIfNeeded();
    }

    wallet.tokenEndpoints.verifyEmail(token, success, error);
  }

  wallet.unsubscribe = (token, successCallback, errorCallback) => {
    const success = (guid) => {
      successCallback(guid);
      wallet.applyIfNeeded();
    }

    const error = (message) => {
      console.log(message);
      errorCallback(message);
      wallet.applyIfNeeded();
    }

    wallet.tokenEndpoints.unsubscribe(token, success, error);
  }

  wallet.authorizeApprove = (token, successCallback, differentBrowserCallback, differentBrowserApproved, errorCallback) => {
    const success = (guid) => {
      successCallback(guid);
      wallet.applyIfNeeded();
    }

    const error = (message) => {
      console.log(message);
      errorCallback(message);
      wallet.applyIfNeeded();
    }

    const differentBrowser = (details) => {
      differentBrowserCallback(details);
      wallet.applyIfNeeded();
    }

    wallet.tokenEndpoints.authorizeApprove(token, success, differentBrowser, differentBrowserApproved, error);
  }

  // Testing: only works on mock MyWallet

  wallet.refresh = () => {
    wallet.my.refresh();
    wallet.updateTransactions();
  };

  wallet.isMock = wallet.my.mockShouldFailToSend !== void 0;

  return wallet;
}
