// GT One · Fox — programma senza installazione per i garden con il gestionale
// Fox2000 (Areabyte). Legge in SOLA LETTURA due file che Fox riscrive da solo
// nella sua cartella «db»:
//   ARTICOLI.CSV  codice;descrizione;listino;qtamag;...   (latin-1, separatore ;)
//   BARCODE.CSV   barcode;codice
// e manda a GT One giacenza (qtamag) e prezzo di vendita (listino) dei soli
// articoli che GT One chiede (il catalogo Zoo). Il prezzo d'acquisto e le
// altre colonne non vengono nemmeno lette.
//
// Uso:
//   GTOne-Fox.exe            finestra: cartella, chiave, prova, invia, pianifica
//   GTOne-Fox.exe /invia     invio silenzioso (per l'Utilità di pianificazione)
//   GTOne-Fox.exe /verifica  legge i file e scrive nel registro cosa ha trovato, senza inviare
//
// Compilazione (compilatore già presente in Windows, C# 5):
//   %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /out:GTOne-Fox.exe
//     /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll Program.cs

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace GTOneFox
{
    static class Programma
    {
        public const string Versione = "1.0";
        public const string IndirizzoPredefinito = "https://gardenteam.vercel.app";

        [STAThread]
        static int Main(string[] args)
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            string modo = args.Length > 0 ? args[0].ToLowerInvariant() : "";
            if (modo == "/invia" || modo == "/verifica")
            {
                Config cfg = Config.Leggi();
                try
                {
                    string esito = Lavoro.Esegui(cfg, modo == "/verifica");
                    Registro.Scrivi(esito);
                    return 0;
                }
                catch (Exception e)
                {
                    Registro.Scrivi("ERRORE: " + e.Message);
                    return 1;
                }
            }
            Application.EnableVisualStyles();
            Application.Run(new Finestra());
            return 0;
        }
    }

    /// <summary>Impostazioni in GTOne-Fox.ini accanto al programma (o in %APPDATA% se lì non si può scrivere).</summary>
    class Config
    {
        public string Cartella = "";
        public string Chiave = "";
        public string Indirizzo = Programma.IndirizzoPredefinito;

        public static string Percorso()
        {
            string accanto = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "GTOne-Fox.ini");
            if (File.Exists(accanto) || Scrivibile(AppDomain.CurrentDomain.BaseDirectory)) return accanto;
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GTOne-Fox");
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "GTOne-Fox.ini");
        }

        static bool Scrivibile(string dir)
        {
            try { string p = Path.Combine(dir, ".prova_scrittura"); File.WriteAllText(p, "x"); File.Delete(p); return true; }
            catch { return false; }
        }

        public static Config Leggi()
        {
            Config c = new Config();
            string p = Percorso();
            if (!File.Exists(p)) return c;
            foreach (string riga in File.ReadAllLines(p, Encoding.UTF8))
            {
                int i = riga.IndexOf('=');
                if (i < 0) continue;
                string k = riga.Substring(0, i).Trim().ToLowerInvariant(), v = riga.Substring(i + 1).Trim();
                if (k == "cartella") c.Cartella = v;
                else if (k == "chiave") c.Chiave = v;
                else if (k == "indirizzo" && v.StartsWith("https://")) c.Indirizzo = v.TrimEnd('/');
            }
            return c;
        }

        public void Salva()
        {
            File.WriteAllText(Percorso(), "cartella=" + Cartella + "\r\nchiave=" + Chiave + "\r\nindirizzo=" + Indirizzo + "\r\n", Encoding.UTF8);
        }
    }

    static class Registro
    {
        public static string Percorso() { return Path.Combine(Path.GetDirectoryName(Config.Percorso()), "GTOne-Fox.log"); }

        public static void Scrivi(string testo)
        {
            try
            {
                string p = Percorso();
                // il registro non cresce all'infinito: oltre 1 MB si riparte
                if (File.Exists(p) && new FileInfo(p).Length > 1024 * 1024) File.Delete(p);
                File.AppendAllText(p, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + testo + "\r\n", Encoding.UTF8);
            }
            catch { }
        }
    }

    class Articolo { public string Codice; public double Prezzo; public int Giacenza; }

    static class Lavoro
    {
        static readonly Encoding Latino = Encoding.GetEncoding(28591);

        /// <summary>Apre un file in sola lettura lasciando che il gestionale continui a scriverlo.</summary>
        static StreamReader ApriSoloLettura(string percorso)
        {
            FileStream fs = new FileStream(percorso, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            return new StreamReader(fs, Latino);
        }

        static int Colonna(string[] intestazione, string nome)
        {
            for (int i = 0; i < intestazione.Length; i++)
                if (intestazione[i].Trim().ToLowerInvariant() == nome) return i;
            return -1;
        }

        /// <summary>"00139.000" → 139; "-000001" → -1.</summary>
        static double Numero(string s)
        {
            double v;
            s = (s ?? "").Trim().Replace(',', '.');
            return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : 0;
        }

        /// <summary>codice → prezzo di vendita e giacenza, dal file ARTICOLI.CSV (solo quelle colonne).</summary>
        public static Dictionary<string, Articolo> LeggiArticoli(string cartella)
        {
            string p = Path.Combine(cartella, "ARTICOLI.CSV");
            if (!File.Exists(p)) throw new Exception("Non trovo ARTICOLI.CSV in " + cartella + " (serve la cartella «db» del gestionale Fox).");
            Dictionary<string, Articolo> ris = new Dictionary<string, Articolo>();
            using (StreamReader r = ApriSoloLettura(p))
            {
                string[] testa = (r.ReadLine() ?? "").Split(';');
                int iCod = Colonna(testa, "codice"), iList = Colonna(testa, "listino"), iQta = Colonna(testa, "qtamag");
                if (iCod < 0 || iList < 0 || iQta < 0) throw new Exception("ARTICOLI.CSV non ha le colonne attese (codice, listino, qtamag).");
                string riga;
                while ((riga = r.ReadLine()) != null)
                {
                    string[] c = riga.Split(';');
                    if (c.Length <= Math.Max(iCod, Math.Max(iList, iQta))) continue;
                    string cod = c[iCod].Trim();
                    if (cod.Length == 0) continue;
                    Articolo a = new Articolo();
                    a.Codice = cod;
                    a.Prezzo = Math.Round(Numero(c[iList]), 2);
                    a.Giacenza = (int)Math.Round(Numero(c[iQta]));
                    ris[cod] = a;
                }
            }
            return ris;
        }

        /// <summary>barcode → codice articolo, dal file BARCODE.CSV.</summary>
        public static Dictionary<string, string> LeggiBarcode(string cartella)
        {
            string p = Path.Combine(cartella, "BARCODE.CSV");
            Dictionary<string, string> ris = new Dictionary<string, string>();
            if (!File.Exists(p)) return ris; // senza, valgono i codici articolo uguali all'EAN
            using (StreamReader r = ApriSoloLettura(p))
            {
                string[] testa = (r.ReadLine() ?? "").Split(';');
                int iBar = Colonna(testa, "barcode"), iCod = Colonna(testa, "codice");
                if (iBar < 0) iBar = 0;
                if (iCod < 0) iCod = 1;
                string riga;
                while ((riga = r.ReadLine()) != null)
                {
                    string[] c = riga.Split(';');
                    if (c.Length <= Math.Max(iBar, iCod)) continue;
                    string b = c[iBar].Trim();
                    if (b.Length > 0 && !ris.ContainsKey(b)) ris[b] = c[iCod].Trim();
                }
            }
            return ris;
        }

        static WebClient Client(Config cfg)
        {
            WebClient w = new WebClient();
            w.Encoding = Encoding.UTF8;
            w.Headers[HttpRequestHeader.Authorization] = "Bearer " + cfg.Chiave;
            w.Headers[HttpRequestHeader.UserAgent] = "GTOne-Fox/" + Programma.Versione;
            return w;
        }

        static string Errore(WebException e)
        {
            HttpWebResponse r = e.Response as HttpWebResponse;
            if (r == null) return "GT One non raggiungibile (" + e.Message + ")";
            try
            {
                using (StreamReader sr = new StreamReader(r.GetResponseStream()))
                {
                    Dictionary<string, object> j = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(sr.ReadToEnd());
                    if (j != null && j.ContainsKey("error")) return Convert.ToString(j["error"]);
                }
            }
            catch { }
            return "GT One ha risposto " + (int)r.StatusCode;
        }

        /// <summary>Legge, chiede a GT One gli EAN che servono e manda giacenze e prezzi. Ritorna l'esito in una riga.</summary>
        public static string Esegui(Config cfg, bool soloVerifica)
        {
            if (string.IsNullOrEmpty(cfg.Cartella)) throw new Exception("Manca la cartella degli archivi Fox.");
            DateTime t0 = DateTime.Now;
            Dictionary<string, Articolo> articoli = LeggiArticoli(cfg.Cartella);
            Dictionary<string, string> barcode = LeggiBarcode(cfg.Cartella);
            DateTime fileAl = File.GetLastWriteTime(Path.Combine(cfg.Cartella, "ARTICOLI.CSV"));
            string letti = articoli.Count + " articoli e " + barcode.Count + " codici a barre (file del " + fileAl.ToString("dd/MM HH:mm") + ")";
            if (soloVerifica) return "VERIFICA: letti " + letti + " in " + (int)(DateTime.Now - t0).TotalMilliseconds + " ms. Nessun invio.";
            if (string.IsNullOrEmpty(cfg.Chiave)) throw new Exception("Manca la chiave di GT One (GT One → Connettori → Programma Fox).");

            JavaScriptSerializer js = new JavaScriptSerializer();
            js.MaxJsonLength = int.MaxValue;
            string url = cfg.Indirizzo.TrimEnd('/') + "/api/connettori/fox";
            Dictionary<string, object> richiesta;
            try
            {
                using (WebClient w = Client(cfg)) richiesta = js.Deserialize<Dictionary<string, object>>(w.DownloadString(url));
            }
            catch (WebException e) { throw new Exception(Errore(e)); }
            string ambito = richiesta.ContainsKey("ambito") ? Convert.ToString(richiesta["ambito"]) : "";
            object[] eans = richiesta.ContainsKey("eans") ? (richiesta["eans"] as object[] ?? (richiesta["eans"] as System.Collections.ArrayList ?? new System.Collections.ArrayList()).ToArray()) : new object[0];

            List<Dictionary<string, object>> righe = new List<Dictionary<string, object>>();
            foreach (object o in eans)
            {
                string ean = Convert.ToString(o);
                string cod;
                if (!barcode.TryGetValue(ean, out cod)) cod = ean; // a volte il codice articolo è l'EAN stesso
                Articolo a;
                if (!articoli.TryGetValue(cod, out a)) continue;
                Dictionary<string, object> r = new Dictionary<string, object>();
                r["ean"] = ean; r["codice"] = a.Codice; r["giacenza"] = a.Giacenza; r["prezzo"] = a.Prezzo;
                righe.Add(r);
            }
            Dictionary<string, object> corpo = new Dictionary<string, object>();
            corpo["righe"] = righe;
            corpo["fileAl"] = fileAl.ToString("yyyy-MM-ddTHH:mm:ss");
            corpo["versione"] = Programma.Versione;
            string risposta;
            try
            {
                using (WebClient w = Client(cfg))
                {
                    w.Headers[HttpRequestHeader.ContentType] = "application/json";
                    risposta = w.UploadString(url, "POST", js.Serialize(corpo));
                }
            }
            catch (WebException e) { throw new Exception(Errore(e)); }
            Dictionary<string, object> esito = js.Deserialize<Dictionary<string, object>>(risposta);
            return "INVIATO a GT One (" + ambito + "): " + Convert.ToString(esito.ContainsKey("righe") ? esito["righe"] : righe.Count)
                + " articoli dello Zoo su " + eans.Length + " chiesti; letti " + letti + ".";
        }
    }

    class Finestra : Form
    {
        TextBox cartella = new TextBox(), chiave = new TextBox(), indirizzo = new TextBox(), registro = new TextBox();
        CheckBox ogniOra = new CheckBox();
        Timer timer = new Timer();
        Config cfg = Config.Leggi();

        public Finestra()
        {
            Text = "GT One · Fox " + Programma.Versione;
            Font = new Font("Segoe UI", 9.5f);
            ClientSize = new Size(620, 470);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;

            Label intro = Etichetta("Manda a GT One giacenze e prezzi di vendita degli articoli dello Zoo, leggendo in sola lettura la cartella «db» del gestionale Fox (ARTICOLI.CSV e BARCODE.CSV). Il prezzo d'acquisto non viene letto.", 12, 10, 596, 40);
            Controls.Add(intro);

            Controls.Add(Etichetta("Cartella archivi Fox (quella con ARTICOLI.CSV)", 12, 58, 400, 18));
            cartella.SetBounds(12, 78, 490, 24); cartella.Text = cfg.Cartella; Controls.Add(cartella);
            Button sfoglia = Pulsante("Sfoglia…", 508, 77, 100); sfoglia.Click += delegate { Sfoglia(); }; Controls.Add(sfoglia);

            Controls.Add(Etichetta("Chiave GT One (GT One → Connettori → Programma Fox)", 12, 110, 400, 18));
            chiave.SetBounds(12, 130, 596, 24); chiave.Text = cfg.Chiave; chiave.UseSystemPasswordChar = true; Controls.Add(chiave);

            Controls.Add(Etichetta("Indirizzo GT One", 12, 162, 400, 18));
            indirizzo.SetBounds(12, 182, 596, 24); indirizzo.Text = cfg.Indirizzo; Controls.Add(indirizzo);

            Button prova = Pulsante("Prova la lettura", 12, 218, 140); prova.Click += delegate { Lancia(true); }; Controls.Add(prova);
            Button invia = Pulsante("Invia adesso", 158, 218, 120); invia.Click += delegate { Lancia(false); }; Controls.Add(invia);
            Button pianifica = Pulsante("Invio automatico ogni ora…", 284, 218, 210); pianifica.Click += delegate { Pianifica(); }; Controls.Add(pianifica);
            Button log = Pulsante("Registro", 500, 218, 108); log.Click += delegate { if (File.Exists(Registro.Percorso())) Process.Start("notepad.exe", "\"" + Registro.Percorso() + "\""); }; Controls.Add(log);

            ogniOra.Text = "Finché la finestra è aperta, invia anche da solo ogni ora";
            ogniOra.SetBounds(12, 252, 596, 22);
            ogniOra.CheckedChanged += delegate { timer.Enabled = ogniOra.Checked; };
            Controls.Add(ogniOra);
            timer.Interval = 60 * 60 * 1000;
            timer.Tick += delegate { Lancia(false); };

            registro.SetBounds(12, 280, 596, 178);
            registro.Multiline = true; registro.ReadOnly = true; registro.ScrollBars = ScrollBars.Vertical;
            registro.BackColor = Color.White;
            Controls.Add(registro);
            Scrivi("Pronto. " + (cfg.Cartella.Length == 0 ? "Scegli la cartella «db» del gestionale Fox e incolla la chiave di GT One." : "Impostazioni in " + Config.Percorso()));
        }

        static Label Etichetta(string testo, int x, int y, int w, int h) { Label l = new Label(); l.Text = testo; l.SetBounds(x, y, w, h); return l; }
        static Button Pulsante(string testo, int x, int y, int w) { Button b = new Button(); b.Text = testo; b.SetBounds(x, y, w, 28); return b; }

        void Scrivi(string t) { registro.AppendText(DateTime.Now.ToString("HH:mm:ss") + "  " + t + "\r\n"); }

        void Sfoglia()
        {
            using (FolderBrowserDialog d = new FolderBrowserDialog())
            {
                d.Description = "La cartella «db» del gestionale Fox (es. \\\\server\\areabyte\\db)";
                if (Directory.Exists(cartella.Text)) d.SelectedPath = cartella.Text;
                if (d.ShowDialog(this) == DialogResult.OK) cartella.Text = d.SelectedPath;
            }
        }

        void Salva()
        {
            cfg.Cartella = cartella.Text.Trim();
            cfg.Chiave = chiave.Text.Trim();
            string ind = indirizzo.Text.Trim().TrimEnd('/');
            cfg.Indirizzo = ind.StartsWith("https://") ? ind : Programma.IndirizzoPredefinito;
            try { cfg.Salva(); } catch (Exception e) { Scrivi("Impostazioni non salvate: " + e.Message); }
        }

        void Lancia(bool soloVerifica)
        {
            Salva();
            Cursor = Cursors.WaitCursor;
            try
            {
                string esito = Lavoro.Esegui(cfg, soloVerifica);
                Scrivi(esito);
                Registro.Scrivi(esito);
            }
            catch (Exception e)
            {
                Scrivi("ERRORE: " + e.Message);
                Registro.Scrivi("ERRORE: " + e.Message);
            }
            finally { Cursor = Cursors.Default; }
        }

        /// <summary>Un'attività dell'Utilità di pianificazione per l'utente: ogni ora, anche a finestra chiusa.</summary>
        void Pianifica()
        {
            Salva();
            string exe = Application.ExecutablePath;
            if (MessageBox.Show(this, "Creo un'attività di Windows «GT One Fox» che ogni ora lancia:\n\n" + exe + " /invia\n\n"
                + "(per il tuo utente, senza diritti di amministratore). Il programma deve restare in questa cartella.", "Invio automatico",
                MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return;
            ProcessStartInfo psi = new ProcessStartInfo("schtasks.exe",
                "/Create /F /SC HOURLY /TN \"GT One Fox\" /TR \"\\\"" + exe + "\\\" /invia\"");
            psi.CreateNoWindow = true; psi.UseShellExecute = false; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
            try
            {
                using (Process p = Process.Start(psi))
                {
                    string o = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
                    p.WaitForExit();
                    Scrivi(p.ExitCode == 0 ? "Invio automatico attivato: ogni ora (attività «GT One Fox»). Per toglierlo: Utilità di pianificazione." : "Attività non creata: " + o.Trim());
                }
            }
            catch (Exception e) { Scrivi("Attività non creata: " + e.Message); }
        }
    }
}
