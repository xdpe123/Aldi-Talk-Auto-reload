import puppeteer, { Browser, Page } from 'puppeteer';
import { config } from 'dotenv';

config();

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

const wait = (seconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, seconds * 1000));


// ======================================================
// Browser
// ======================================================

const createBrowser = async (): Promise<Browser> => {
  return await puppeteer.launch({
    headless: true,
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


// ======================================================
// Seite laden
// ======================================================

const waitForPageLoad = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => document.readyState === 'complete',
    { timeout: 30000 }
  );

  console.log('Page loaded successfully');
};


// ======================================================
// Cookies
// ======================================================

const acceptCookies = async (page: Page): Promise<void> => {
  await wait(3);

  try {
    await page.locator(SELECTORS.COOKIE_ACCEPT).click();

    console.log('Cookies accepted');

    await wait(2);
  } catch {
    console.log(
      'Cookie banner not found or already accepted'
    );
  }
};


// ======================================================
// Loginformular erkennen
// ======================================================

const isLoginFormVisible = async (
  page: Page
): Promise<boolean> => {
  try {
    const field =
      await page.$(SELECTORS.USERNAME_FIELD);

    return field !== null;
  } catch {
    return false;
  }
};


// ======================================================
// Login
// ======================================================

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
      'Login-Button "Anmelden" wurde nicht gefunden'
    );
  }

  console.log('Login submitted');

  await wait(8);
};


// ======================================================
// SMS-Abfrage erkennen
// ======================================================

const isSmsVerificationVisible = async (
  page: Page
): Promise<boolean> => {
  return await page.evaluate(() => {

    const collectElements = (
      root: Document | ShadowRoot
    ): Element[] => {
      const result: Element[] = [];

      root.querySelectorAll('*').forEach(element => {
        result.push(element);

        if (element.shadowRoot) {
          result.push(
            ...collectElements(element.shadowRoot)
          );
        }
      });

      return result;
    };

    const elements =
      collectElements(document);


    // Gesamter sichtbarer Text inkl. Shadow DOM
    const allText = elements
      .map(element => element.textContent || '')
      .join(' ')
      .toLowerCase();


    const verificationText =
      allText.includes('bestätigungscode') ||
      allText.includes('sms-code') ||
      allText.includes('sms code') ||
      allText.includes('einmalcode') ||
      allText.includes('einmal-code') ||
      (
        allText.includes('sms') &&
        allText.includes('bestätig')
      );


    // Eingabefelder suchen
    const inputs = elements.filter(
      element =>
        element instanceof HTMLInputElement
    ) as HTMLInputElement[];


    const visibleInputs = inputs.filter(input => {
      const rect =
        input.getBoundingClientRect();

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        !input.disabled
      );
    });


    // Mehrere einzelne Felder für Ziffern
    const singleDigitInputs =
      visibleInputs.filter(
        input => input.maxLength === 1
      );


    const multipleOtpFields =
      singleDigitInputs.length >= 4;


    // Ein einzelnes OTP-/Code-Feld
    const singleCodeInput =
      visibleInputs.some(input => {

        const description = [
          input.name,
          input.id,
          input.placeholder,
          input.autocomplete,
          input.getAttribute('aria-label') || ''
        ]
          .join(' ')
          .toLowerCase();


        return (
          input.autocomplete === 'one-time-code' ||
          description.includes('code') ||
          description.includes('otp') ||
          description.includes('bestätigung')
        );
      });


    // Text alleine reicht NICHT mehr.
    // Es muss auch ein plausibles Code-Feld geben.
    return (
      verificationText &&
      (
        multipleOtpFields ||
        singleCodeInput
      )
    );
  });
};


// ======================================================
// SMS-Code eingeben
// ======================================================

const performSmsVerification = async (
  page: Page
): Promise<void> => {
  const { SMS_CODE } = process.env;

  if (!SMS_CODE) {
    throw new Error(
      'SMS_CODE wurde nicht angegeben'
    );
  }

  console.log(
    'Bestehende SMS-Abfrage erkannt.'
  );

  console.log(
    'SMS-Code wird eingegeben...'
  );


  const inserted = await page.evaluate(
    (code: string) => {

      const collectElements = (
        root: Document | ShadowRoot
      ): Element[] => {
        const result: Element[] = [];

        root.querySelectorAll('*').forEach(element => {
          result.push(element);

          if (element.shadowRoot) {
            result.push(
              ...collectElements(element.shadowRoot)
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


      const setValue = (
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


      // Mehrere Felder, eins pro Ziffer

      const digitInputs =
        visibleInputs.filter(
          input => input.maxLength === 1
        );


      if (
        digitInputs.length >= code.length
      ) {

        code
          .split('')
          .forEach((digit, index) => {
            setValue(
              digitInputs[index],
              digit
            );
          });

        return true;
      }


      // Ein einzelnes Codefeld

      const codeInput =
        visibleInputs.find(input => {

          const description = [
            input.name,
            input.id,
            input.placeholder,
            input.autocomplete,
            input.getAttribute('aria-label') || ''
          ]
            .join(' ')
            .toLowerCase();


          return (
            input.autocomplete === 'one-time-code' ||
            description.includes('code') ||
            description.includes('otp') ||
            description.includes(
              'bestätigung'
            )
          );
        });


      if (!codeInput) {
        return false;
      }


      setValue(
        codeInput,
        code
      );

      return true;

    },

    SMS_CODE
  );


  if (!inserted) {
    throw new Error(
      'SMS-Code-Feld wurde nicht gefunden'
    );
  }


  console.log(
    'SMS-Code eingetragen.'
  );


  await wait(2);


  // ==================================================
  // Bestätigungsbutton
  // ==================================================

  const submitted = await page.evaluate(() => {

    const collectElements = (
      root: Document | ShadowRoot
    ): Element[] => {
      const result: Element[] = [];

      root.querySelectorAll('*').forEach(element => {
        result.push(element);

        if (element.shadowRoot) {
          result.push(
            ...collectElements(element.shadowRoot)
          );
        }
      });

      return result;
    };


    const elements =
      collectElements(document);


    const button = elements.find(element => {

      const tag =
        element.tagName.toLowerCase();


      if (
        tag !== 'button' &&
        tag !== 'one-button'
      ) {
        return false;
      }


      const text =
        (element.textContent || '')
          .trim()
          .toLowerCase();


      return (
        (
          text.includes('bestätigen') ||
          text.includes('verifizieren') ||
          text === 'weiter'
        ) &&
        !text.includes('erneut') &&
        !text.includes('senden')
      );

    }) as HTMLElement | undefined;


    if (!button) {
      return false;
    }


    button.click();

    return true;
  });


  if (!submitted) {
    throw new Error(
      'Bestätigungsbutton wurde nicht gefunden'
    );
  }


  console.log(
    'SMS-Code abgeschickt'
  );


  await wait(8);


  if (
    await isSmsVerificationVisible(page)
  ) {
    throw new Error(
      'SMS-Bestätigung ist weiterhin sichtbar. Code möglicherweise falsch oder abgelaufen.'
    );
  }


  console.log(
    'SMS-Bestätigung erfolgreich'
  );
};


// ======================================================
// 1-GB-Button suchen
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


// ======================================================
// 1 GB klicken
// ======================================================

const extendDataVolume = async (
  page: Page
): Promise<void> => {

  await wait(5);


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


  await wait(5);
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
      // WICHTIGE ÄNDERUNG:
      //
      // ZUERST schauen, ob das normale Loginformular
      // sichtbar ist.
      //
      // Damit verhindern wir, dass irgendwelcher
      // allgemeiner SMS-Text auf der Loginseite
      // fälschlich als SMS-Challenge erkannt wird.
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


        // SMS-Seite kann verzögert erscheinen
        await wait(10);


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
            'Diesen Code als Secret SMS_CODE speichern und Workflow erneut starten.'
          );


          // NICHT weiterarbeiten.
          // browser.close() speichert unten das Profil.
          return;
        }


        console.log(
          'Nach dem Login wurde keine SMS-Abfrage erkannt.'
        );

      } else {

        // ==================================================
        // Kein Loginformular:
        //
        // Jetzt kann es entweder
        // - eine offene SMS-Challenge
        // - oder eine gültige Session sein.
        // ==================================================

        if (
          await isSmsVerificationVisible(
            page
          )
        ) {

          console.log(
            'Bestehende SMS-Abfrage erkannt.'
          );


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
              'Den Code aus der bereits erhaltenen SMS als Secret SMS_CODE speichern und Workflow erneut starten.'
            );


            return;
          }


          await performSmsVerification(
            page
          );


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
      }


      // ==================================================
      // Sicherheitschecks
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
      // Gültige Session
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
