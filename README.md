# HeadRush Cleaner

Utility Node.js per individuare IR/Amp Clones/modelli NAM non referenziati da alcun rig né dai preset salvati in `Blocks`.

## Uso

Richiede Node.js 22 o successivo. Non richiede pacchetti npm né Docker.

```sh
./start.sh
./start.sh --data /Volumes/HeadRush
npm start
npm test
```

Il percorso predefinito è il collegamento `HeadRush` nella cartella del progetto. Se non è raggiungibile, l'utility si interrompe con un messaggio che invita a controllare il collegamento USB, il montaggio del volume e il percorso `--data`. Lo script di avvio funziona anche se chiamato da un'altra directory.

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

```sh
docker compose run --rm cleaner
```

Usa lo stesso flusso interattivo. Il dispositivo è montato in lettura e scrittura e deve già esistere. Su sistemi diversi da macOS impostare `HEADRUSH_PATH` al percorso corretto. Non è necessario avviare Docker con `sudo` o installare dipendenze nel container.
