import puppeteer, { Browser, Page } from 'puppeteer';
import { config } from 'dotenv';

config();

// ======================================================
// Konfiguration
// ======================================================

const URLS = {
  ALDITALK_PORTAL:
    'https://www.alditalk-kundenportal.de/portal/auth/uebersicht/'
} as const;

const SELECTORS = {
  DATA_BUTTON: 'one-button[slot="action"]',
  DATA_TEXT: 'one-text',

  COOKIE_ACCEPT:
    '::-p-aria([name="Akzeptieren"][role="button"])',

  USERNAME_FIELD:
    '::-p-aria([name="Rufnummer"])',

  PASSWORD_FIELD:
    '::-p-aria([name="Passwort"])'
} as const;

const TIMEOUTS = {
  COOKIE_WAIT: 5,
  SHORT_WAIT: 5,
  EXTEND_WAIT: 5
} as const;

// ======================================================
// Hilfsfunktionen
// ======================================================

const wait = (seconds: number): Promise<void> =>
  new Promise(resolve =>
    setTimeout(resolve, seconds * 1000)
  );

const createBrowser = async (): Promise<Browser> => {
  return await puppeteer.launch({
    headless: true,

    // WICHTIG:
    // Dieses Profil wird von GitHub Actions gespeichert
    // und beim nächsten Lauf wieder geladen.
    userDataDir: './browser-profile',

    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });
};

const waitForPageLoad = async (
  page: Page
): Promise<void> => {
  await page.waitForFunction(
    () => document.readyState === 'complete',
    { timeout: 30000 }
  );

  console.log('Page loaded successfully');
};

// ======================================================
// Cookies
// ======================================================

const acceptCookies = async (
  page: Page
): Promise<void> => {
  await wait(TIMEOUTS.COOKIE_WAIT);

  try {
    await page
      .locator(SELECTORS.COOKIE_ACCEPT)
      .click();

    console.log('Cookies accepted');

    await wait(TIMEOUTS.SHORT_WAIT);
  } catch {
    console.log(
      'Cookie banner not found or already accepted'
    );
  }
};

// ======================================================
// Login
// ======================================================

const isLoginFormVisible = async (
  page: Page
): Promise<boolean> => {
  try {
    const field = await page.$(
      SELECTORS.USERNAME_FIELD
    );

    return field !== null;
  } catch {
    return false;
  }
};

const performLogin = async (
  page: Page
): Promise<void> => {
  const { USERNAME, PASSWORD } = process.env;

  if (!USERNAME || !PASSWORD) {
    throw new Error(
      'USERNAME oder PASSWORD fehlt'
    );
  }

  console.log('Filling login form...');

  await page
    .locator(SELECTORS.USERNAME_FIELD)
    .fill(USERNAME);

  await page
    .locator(SELECTORS.PASSWORD_FIELD)
    .fill(PASSWORD);

  await wait(2);

  console.log('Trying to submit login...');

  const submitted = await page.evaluate(() => {
    const elements = Array.from(
      document.querySelectorAll(
        'button, one-button'
      )
    );

    const button = elements.find(element =>
      (element.textContent || '')
        .trim()
        .includes('Anmelden')
    ) as HTMLElement | undefined;

    if (!button) {
      return false;
    }

    button.click();
    return true;
  });

  if (!submitted) {
    throw new Error(
      'Login-Button "Anmelden" nicht gefunden'
    );
  }

  console.log('Login submitted');

  await wait(5);
};

// ======================================================
// SMS-Bestätigung
// ======================================================

const isSmsVerificationVisible = async (
  page: Page
): Promise<boolean> => {
  const text = await page.evaluate(() =>
    document.body.innerText.toLowerCase()
  );

  return (
    text.includes('bestätigungscode') ||
    (
      text.includes('sms') &&
      (
        text.includes('code') ||
        text.includes('bestätig')
      )
    )
  );
};

const performSmsVerification = async (
  page: Page
): Promise<void> => {
  const { SMS_CODE } = process.env;

  if (!SMS_CODE) {
    throw new Error(
      'SMS_CODE wurde nicht als Secret angegeben'
    );
  }

  console.log(
    'Bestehende SMS-Bestätigung gefunden.'
  );

  console.log(
    'SMS-Code wird eingegeben...'
  );

  const codeInserted = await page.evaluate(
    (code: string) => {

      const collectElements = (
        root: Document | ShadowRoot
      ): Element[] => {
        const result: Element[] = [];

        root
          .querySelectorAll('*')
          .forEach(element => {
            result.push(element);

            if (element.shadowRoot) {
              result.push(
                ...collectElements(
                  element.shadowRoot
                )
              );
            }
          });

        return result;
      };

      const elements =
        collectElements(document);

      const inputs = elements.filter(
        element =>
          element instanceof HTMLInputElement
      ) as HTMLInputElement[];

      const visibleInputs =
        inputs.filter(input => {
          const rect =
            input.getBoundingClientRect();

          return (
            rect.width > 0 &&
            rect.height > 0 &&
            !input.disabled
          );
        });

      const setInputValue = (
        input: HTMLInputElement,
        value: string
      ) => {
        const setter =
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
          )?.set;

        if (setter) {
          setter.call(input, value);
        } else {
          input.value = value;
        }

        input.dispatchEvent(
          new Event('input', {
            bubbles: true
          })
        );

        input.dispatchEvent(
          new Event('change', {
            bubbles: true
          })
        );
      };

      // Manche Seiten haben ein Feld
      // für jede einzelne Ziffer.

      const digitInputs =
        visibleInputs.filter(
          input =>
            input.maxLength === 1
        );

      if (
        digitInputs.length >=
        code.length
      ) {
        code
          .split('')
          .forEach(
            (digit, index) => {
              setInputValue(
                digitInputs[index],
                digit
              );
            }
          );

        return true;
      }

      // Sonst ein einzelnes Code-Feld suchen.

      const codeInput =
        visibleInputs.find(input => {
          const name =
            input.name.toLowerCase();

          const id =
            input.id.toLowerCase();

          const placeholder =
            input.placeholder.toLowerCase();

          return (
            input.autocomplete ===
              'one-time-code' ||
            name.includes('code') ||
            id.includes('code') ||
            placeholder.includes('code') ||
            placeholder.includes(
              'bestätigung'
            )
          );
        }) ??
        visibleInputs.find(input =>
          [
            'text',
            'tel',
            'number'
          ].includes(input.type)
        );

      if (!codeInput) {
        return false;
      }

      setInputValue(
        codeInput,
        code
      );

      return true;
    },

    SMS_CODE
  );

  if (!codeInserted) {
    throw new Error(
      'SMS-Code-Feld wurde nicht gefunden'
    );
  }

  await wait(2);

  console.log(
    'SMS-Code eingetragen.'
  );

  // ==================================================
  // Bestätigungsbutton suchen
  // ==================================================

  const submitted = await page.evaluate(
    () => {

      const collectElements = (
        root: Document | ShadowRoot
      ): Element[] => {
        const result: Element[] = [];

        root
          .querySelectorAll('*')
          .forEach(element => {
            result.push(element);

            if (element.shadowRoot) {
              result.push(
                ...collectElements(
                  element.shadowRoot
                )
              );
            }
          });

        return result;
      };

      const elements =
        collectElements(document);

      const button =
        elements.find(element => {
          const text =
            (
              element.textContent ||
              ''
            )
              .trim()
              .toLowerCase();

          const tag =
            element.tagName.toLowerCase();

          const isButton =
            tag === 'button' ||
            tag === 'one-button';

          if (!isButton) {
            return false;
          }

          return (
            (
              text.includes(
                'bestätigen'
              ) ||
              text === 'weiter' ||
              text.includes(
                'verifizieren'
              )
            ) &&
            !text.includes('erneut') &&
            !text.includes('senden')
          );
        }) as
          | HTMLElement
          | undefined;

      if (!button) {
        return false;
      }

      button.click();

      return true;
    }
  );

  if (!submitted) {
    throw new Error(
      'Button zur SMS-Bestätigung wurde nicht gefunden'
    );
  }

  console.log(
    'SMS-Code abgeschickt'
  );

  await wait(7);

  if (
    await isSmsVerificationVisible(
      page
    )
  ) {
    throw new Error(
      'SMS-Bestätigung ist weiterhin sichtbar. Code möglicherweise ungültig oder abgelaufen.'
    );
  }

  console.log(
    'SMS-Bestätigung erfolgreich'
  );
};

// ======================================================
// 1-GB-Button
// ======================================================

const findDataVolumeButton = async (
  page: Page
) => {
  const buttons =
    await page.$$(
      SELECTORS.DATA_BUTTON
    );

  for (const button of buttons) {
    try {
      const textContent =
        await button.$eval(
          SELECTORS.DATA_TEXT,
          element =>
            element.textContent?.trim()
        );

      if (
        textContent === '1 GB'
      ) {
        return button;
      }
    } catch {
      continue;
    }
  }

  return null;
};

const extendDataVolume = async (
  page: Page
): Promise<void> => {
  await wait(
    TIMEOUTS.EXTEND_WAIT
  );

  const button =
    await findDataVolumeButton(
      page
    );

  if (!button) {
    console.log(
      '1-GB-Button nicht gefunden.'
    );

    return;
  }

  await button.click();

  console.log(
    '1-GB-Button wurde geklickt.'
  );

  await wait(
    TIMEOUTS.EXTEND_WAIT
  );
};

// ======================================================
// Hauptablauf
// ======================================================

const executeAutomation =
  async (): Promise<void> => {

    const browser =
      await createBrowser();

    try {
      const page =
        await browser.newPage();

      await page.setViewport({
        width: 1080,
        height: 1024
      });

      await page.goto(
        URLS.ALDITALK_PORTAL,
        {
          waitUntil: 'networkidle2',
          timeout: 30000
        }
      );

      await waitForPageLoad(
        page
      );

      await acceptCookies(
        page
      );

      // ==================================================
      // 1. ZUERST prüfen:
      // Ist aus dem letzten Lauf bereits
      // eine SMS-Abfrage offen?
      // ==================================================

      if (
        await isSmsVerificationVisible(
          page
        )
      ) {
        console.log(
          'Bestehende SMS-Abfrage erkannt.'
        );

        // Noch kein SMS_CODE gesetzt:
        // Session einfach speichern lassen.
        if (
          !process.env.SMS_CODE
        ) {
          console.log(
            'Kein SMS_CODE vorhanden.'
          );

          console.log(
            'Browser-Session wird gespeichert.'
          );

          console.log(
            'SMS_CODE als GitHub Secret eintragen und Workflow erneut starten.'
          );

          return;
        }

        // Vorhandene SMS-Abfrage mit
        // dem Code aus dem Secret bestätigen.
        await performSmsVerification(
          page
        );

        // Danach Übersicht neu öffnen.
        await page.goto(
          URLS.ALDITALK_PORTAL,
          {
            waitUntil:
              'networkidle2',
            timeout: 30000
          }
        );

        await waitForPageLoad(
          page
        );

        await acceptCookies(
          page
        );
      }

      // ==================================================
      // 2. Nur wenn wirklich das Loginformular
      // sichtbar ist, neu einloggen.
      // ==================================================

      if (
        await isLoginFormVisible(
          page
        )
      ) {
        console.log(
          'Keine gültige Session - Login wird durchgeführt...'
        );

        await performLogin(
          page
        );

        await waitForPageLoad(
          page
        );

        await acceptCookies(
          page
        );

        // Nach DIESEM Login wurde gerade
        // ein neuer SMS-Code erzeugt.
        //
        // Deshalb den eventuell vorhandenen
        // SMS_CODE NICHT verwenden.
        //
        // Browserprofil speichern und
        // Workflow beenden.

        if (
          await isSmsVerificationVisible(
            page
          )
        ) {
          console.log(
            'SMS-Bestätigung erforderlich.'
          );

          console.log(
            'Ein neuer SMS-Code wurde gesendet.'
          );

          console.log(
            'Browser-Session wird jetzt gespeichert.'
          );

          console.log(
            'Diesen neuen Code als SMS_CODE Secret speichern und Workflow erneut starten.'
          );

          return;
        }
      }

      // ==================================================
      // 3. Sicherheitsprüfung
      // ==================================================

      if (
        await isSmsVerificationVisible(
          page
        )
      ) {
        console.log(
          'SMS-Bestätigung noch nicht abgeschlossen.'
        );

        return;
      }

      if (
        await isLoginFormVisible(
          page
        )
      ) {
        throw new Error(
          'Login nicht erfolgreich'
        );
      }

      // ==================================================
      // 4. Jetzt sollte eine gültige Session bestehen
      // ==================================================

      console.log(
        'Gültige ALDI TALK Session vorhanden.'
      );

      console.log(
        'Current URL:',
        page.url()
      );

      await extendDataVolume(
        page
      );

      console.log(
        'Automation completed successfully'
      );

    } finally {
      // Durch browser.close() wird das
      // userDataDir sauber geschrieben.
      await browser.close();
    }
  };

// ======================================================
// Start
// ======================================================

executeAutomation()
  .then(() => {
    console.log(
      'Check finished.'
    );

    process.exit(0);
  })
  .catch(error => {
    console.error(
      'Fatal error:',
      error
    );

    process.exit(1);
  });
