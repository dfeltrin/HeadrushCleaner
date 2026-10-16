# HeadRush Cleaner

Utility Node.js per individuare IR/Amp Clones/modelli NAM non referenziati da alcun rig né dai preset salvati in `Blocks`.

Tutti i rig e i preset vengono conservati. La cancellazione delle risorse inutilizzate richiede una conferma separata per ogni tipologia ed è definitiva, senza backup automatico.

## Requisiti e installazione

Richiede Node.js 22 o successivo e l'accesso in lettura e scrittura alla cartella del dispositivo. Non richiede pacchetti npm né Docker: non serve eseguire `npm install`.

Il repository è privato: per clonarlo devi avere accesso ed essere autenticato su GitHub.

```sh
git clone https://github.com/dfeltrin/HeadrushCleaner.git
cd HeadrushCleaner
node --version
```

## Avvio rapido

Collega la HeadRush via USB e verifica che il volume sia montato. Su macOS, se il volume si chiama `HeadRush`, avvia:

```sh
./start.sh --data /Volumes/HeadRush
```

In alternativa, usa direttamente Node.js o npm; adatta il percorso al tuo dispositivo e usa le virgolette se contiene spazi:

```sh
node cleaner.js --data "/percorso/del/dispositivo"
npm start -- --data "/percorso/del/dispositivo"
```

Il percorso deve indicare la cartella che contiene le librerie, non una singola sottocartella:

| Cartella | Contenuto analizzato | Presenza |
| --- | --- | --- |
| `Rigs` | Rig `.rig` e relativi riferimenti | Obbligatoria |
| `Impulse Responses` | Risorse `.wav` | Obbligatoria |
| `Amp Clones` | Risorse `.ac` | Obbligatoria |
| `Neural Amp Modeler` | Risorse `.nam` | Facoltativa |
| `Blocks` | Preset salvati in formato JSON | Facoltativa |

I nomi delle cartelle vengono riconosciuti anche con maiuscole/minuscole diverse.

### Percorso predefinito

Senza `--data`, l'utility cerca `HeadRush` nella cartella del progetto. Il collegamento locale non è incluso nel repository. Su macOS o Linux puoi crearlo dopo il clone:

```sh
ln -s /Volumes/HeadRush HeadRush
./start.sh
```

Una volta configurato il collegamento, funziona anche `npm start`. Lo script `start.sh` funziona anche se chiamato da un'altra directory. Per vedere la sintassi disponibile:

```sh
node cleaner.js --help
```

## Piano e conferme

Esiste un unico flusso di esecuzione: prima viene mostrato il piano completo, suddiviso in Impulse Responses, Amp Clones e Neural Amp Modeler (`.nam`), con elenco e numero dei file candidati. Poi viene chiesto, per ciascuna tipologia non vuota: `vuoi cancellare definitivamente N file? [s/N]`.

Rispondere `s`, `si` o `sì` per cancellare, oppure `n`, `no` o Invio per saltare la tipologia. Al termine dell'input l'operazione si interrompe senza ulteriori cancellazioni. Le tipologie senza candidati vengono indicate con 0 file e saltate.

Tutti i rig vengono conservati e proteggono le risorse che utilizzano. Le setlist non vengono lette e non sono richieste. Il piano di IR, Amp Clones e NAM viene ricalcolato e mostrato prima della relativa conferma.

## Cancellazione

La cancellazione è definitiva: non viene creato alcun backup. Le precedenti modalità `list` e `delete` e l'opzione `--backup` non sono più disponibili.

Durante l'operazione non modificare rig o preset e non scollegare il dispositivo. Prima di ogni cancellazione vengono ricontrollati dipendenze e contenuti dei candidati. Se una cancellazione fallisce, l'esecuzione si interrompe e riporta il numero di file già cancellati, che non vengono ripristinati. Le impronte dei rig e dei preset letti nell'ultima analisi vengono ricontrollate prima di iniziare; ogni candidato viene verificato nuovamente immediatamente prima della sua rimozione. L'utility non dispone di un blocco esclusivo del filesystem e non è una transazione atomica.

## Controlli

- JSON malformati, strutture non riconosciute, cartelle obbligatorie mancanti e collegamenti simbolici interni interrompono l'analisi.
- Il JSON interno a `content` viene analizzato; i percorsi riconosciuti vengono confrontati esattamente. Per riferimenti con il solo nome vengono conservati tutti gli omonimi.
- I riferimenti vengono confrontati ignorando maiuscole/minuscole e normalizzando Unicode. Le sequenze percentuali vengono considerate sia letteralmente sia decodificate, conservando entrambe le corrispondenze in caso di ambiguità. Formati futuri che codifichino diversamente le dipendenze richiedono un aggiornamento del parser.
- `Impulse Responses/HeadRush`, `Impulse Responses/Choptones` e `Amp Clones/HeadRush` sono protette. Le cartelle principali non vengono eliminate.
- La pulizia delle sottocartelle vuote avviene solo dopo una cancellazione riuscita. File nascosti e metadati macOS vengono conservati. I rig e i preset nascosti vengono comunque analizzati per proteggere le loro dipendenze; i metadati `.DS_Store` e `._*` vengono ignorati.
- Vengono esaminati anche scene/preset in JSON annidato e campi esterni a `content`. I preset in `Blocks` sono sempre conservati e proteggono tutte le loro dipendenze riconosciute, anche se non usati nei rig.
- Prima di cancellare IR, Amp Clones o NAM, la verifica considera tutti i rig presenti sul dispositivo.
- La categoria Neural Amp Modeler cerca ricorsivamente i file `.nam` nella cartella `Neural Amp Modeler` del dispositivo, conservando quelli referenziati e tutti i file di altre estensioni. Se la cartella è assente, la categoria mostra 0 file. SuperClones non viene ripulita. I formati binari `.ac` e `.sc` non vengono interpretati come contenitori di ulteriori dipendenze: la protezione copre i riferimenti riconosciuti nei JSON di rig e preset, non eventuali riferimenti interni a formati opachi.

## Docker

In alternativa all'installazione locale di Node.js, puoi usare Docker con Compose. Esegui dalla cartella del progetto:

```sh
docker compose run --rm cleaner
```

Usa lo stesso flusso interattivo e monta per impostazione predefinita `/Volumes/HeadRush`. Per indicare un percorso diverso, su macOS o Linux:

```sh
HEADRUSH_PATH="/percorso/del/dispositivo" docker compose run --rm cleaner
```

Il dispositivo è montato in lettura e scrittura e il percorso deve già esistere ed essere accessibile a Docker. Non è necessario avviare Docker con `sudo` o installare dipendenze nel container.

## Verifica del progetto

```sh
npm test
```

I test usano cartelle temporanee e non richiedono il dispositivo collegato. Verificano conferme, conservazione delle dipendenze, gestione dei cambiamenti durante l'analisi e interruzioni in caso di errore.

## Risoluzione dei problemi

- **Cartella HeadRush non raggiungibile:** controlla collegamento USB, montaggio del volume e percorso `--data`. Dopo un nuovo clone, usa un percorso esplicito oppure crea il collegamento `HeadRush` descritto sopra.
- **Cartella mancante o ambigua:** verifica che `--data` punti alla cartella principale del dispositivo e che contenga le tre librerie obbligatorie, senza duplicati che differiscono solo per maiuscole/minuscole.
- **JSON non leggibile o contenuto non riconosciuto:** controlla il file indicato nell'errore. L'utility interrompe l'analisi se non riesce a interpretare rig o preset.
- **Dipendenze cambiate o file modificato:** interrompi le modifiche al dispositivo ed esegui nuovamente l'utility per ottenere un piano aggiornato.
- **Operazione interrotta durante la cancellazione:** leggi il conteggio dei file già cancellati nel messaggio di errore; quei file non vengono ripristinati.
