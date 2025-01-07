const express = require("express");
const mysql = require("mysql");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const app = express();
const fs = require("fs");
const os = require("os");
const jwt = require("jsonwebtoken");
const winston = require("winston");
const puppeteer = require("puppeteer");
const bcrypt = require("bcrypt");

// Chemin vers le bureau
const bureauPath = path.join(os.homedir(), "Desktop", "factures");

// Vérifie si le dossier 'factures' existe sur le bureau, sinon le créer
if (!fs.existsSync(bureauPath)) {
  fs.mkdirSync(bureauPath);
  console.log("Le dossier 'factures' a été créé sur le bureau.");
} else {
  console.log("Le dossier 'factures' existe déjà sur le bureau.");
}

console.log("Dossier factures sur le bureau prêt à être utilisé :", bureauPath);

app.use(express.static(path.join(__dirname, "public")));
app.use(
  cors({
    origin: "http://localhost:3000", // Autoriser le frontend React
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    credentials: true,
  })
);

app.use(express.json());
app.use("/uploads", express.static("uploads"));

const port = 5001;

// Connexion à la base de données MySQL (MAMP)
const db = mysql.createConnection({
  host: "localhost",
  user: "root", // Utilise root si tu n'as pas modifié l'utilisateur
  password: "root", // Utilise root si tu n'as pas modifié le mot de passe
  database: "gestion_sante",
  socketPath: "/Applications/MAMP/tmp/mysql/mysql.sock", // Spécifie le chemin du socket MySQL de MAMP
});

// Vérification de la connexion à la base de données
db.connect((err) => {
  if (err) {
    console.error("Erreur de connexion à la base de données:", err);
    return;
  }
  console.log("Connecté à la base de données MySQL");
});

// Créer le chemin vers le dossier 'img' dans 'server'
const imgDir = path.join(__dirname, "server", "img");
app.use("/images", express.static(imgDir));

// Vérifier si le dossier 'img' existe, sinon le créer
if (!fs.existsSync(imgDir)) {
  fs.mkdirSync(imgDir, { recursive: true });
}

// Configuration de multer pour stocker les fichiers dans le dossier 'img'
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, imgDir); // Utiliser le dossier 'img'
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Renommer le fichier
  },
});

const upload = multer({ storage });
const PDFDocument = require("pdfkit"); // Si vous souhaitez utiliser PDFKit en complément

{
  /* DEBUT ADMINISTRATION*/
}

// Route pour gérer l'insertion des données et téléversement des images
app.post(
  "/administration",
  upload.fields([{ name: "profil" }, { name: "identite" }]),
  (req, res) => {
    const {
      nom,
      prenom,
      age,
      sexe,
      situation,
      telephone,
      mail,
      departement, // Département choisi dans le formulaire
      code_admin,
      diplome,
      date_e,
      salaire, // Salaire brut
    } = req.body;

    const profil = req.files.profil ? req.files.profil[0] : null;
    const identite = req.files.identite ? req.files.identite[0] : null;

    // Vérifier si le salaire brut existe déjà dans la table salaire
    const checkSalaireQuery = `SELECT id_salaire FROM salaire WHERE salaire_brute = ?`;

    db.query(checkSalaireQuery, [salaire], (err, salaireResults) => {
      if (err) {
        console.error("Erreur lors de la vérification du salaire:", err);
        return res.status(500).json({
          message: "Erreur serveur lors de la vérification du salaire",
          error: err,
        });
      }

      let idSalaire;
      if (salaireResults.length === 0) {
        // Calculer inps et amo à partir du salaire brut
        const inps = salaire * 0.036; // 3.6% de salaire_brute
        const amo = salaire * 0.0306; // 3.06% de salaire_brute

        // Si le salaire n'existe pas, on l'ajoute avec les valeurs calculées
        const salaireQuery = `INSERT INTO salaire (salaire_brute, inps, amo) VALUES (?, ?, ?)`;

        db.query(
          salaireQuery,
          [salaire, inps, amo],
          (err, salaireInsertResults) => {
            if (err) {
              console.error("Erreur lors de l'insertion du salaire:", err);
              return res.status(500).json({
                message: "Erreur serveur lors de l'insertion du salaire",
                error: err,
              });
            }
            idSalaire = salaireInsertResults.insertId;

            // Hacher le code_admin avant d'insérer l'employé
            bcrypt.hash(code_admin, 10, (err, hashedPassword) => {
              if (err) {
                console.error("Erreur lors du hachage du mot de passe:", err);
                return res.status(500).json({
                  message: "Erreur serveur lors du hachage du mot de passe",
                  error: err,
                });
              }
              insertEmploye(
                idSalaire,
                departement,
                nom,
                prenom,
                age,
                sexe,
                situation,
                telephone,
                mail,
                hashedPassword, // Utiliser le mot de passe haché
                diplome,
                date_e,
                profil,
                identite,
                res
              );
            });
          }
        );
      } else {
        // Si le salaire existe déjà, on utilise son id
        idSalaire = salaireResults[0].id_salaire;

        // Hacher le code_admin avant d'insérer l'employé
        bcrypt.hash(code_admin, 10, (err, hashedPassword) => {
          if (err) {
            console.error("Erreur lors du hachage du mot de passe:", err);
            return res.status(500).json({
              message: "Erreur serveur lors du hachage du mot de passe",
              error: err,
            });
          }
          insertEmploye(
            idSalaire,
            departement,
            nom,
            prenom,
            age,
            sexe,
            situation,
            telephone,
            mail,
            hashedPassword, // Utiliser le mot de passe haché
            diplome,
            date_e,
            profil,
            identite,
            res
          );
        });
      }
    });
  }
);
// Fonction pour insérer l'employé dans la table administration
function insertEmploye(
  idSalaire,
  departement,
  nom,
  prenom,
  age,
  sexe,
  situation,
  mail,
  telephone,
  code_admin,
  diplome,
  date_e,
  profil,
  identite,
  res
) {
  // Étape 2 : Insérer le département dans la table departements si nécessaire
  const departementQuery = `SELECT id_departement FROM departements WHERE departement = ?`;

  db.query(departementQuery, [departement], (err, departementResults) => {
    if (err) {
      console.error("Erreur lors de la vérification du département:", err);
      return res.status(500).json({
        message: "Erreur serveur lors de la vérification du département",
        error: err,
      });
    }

    let idDepartement;
    if (departementResults.length === 0) {
      // Si le département n'existe pas, on l'ajoute
      const insertDepartementQuery = `INSERT INTO departements (departement) VALUES (?)`;

      db.query(
        insertDepartementQuery,
        [departement],
        (err, insertDepartementResults) => {
          if (err) {
            console.error("Erreur lors de l'insertion du département:", err);
            return res.status(500).json({
              message: "Erreur serveur lors de l'insertion du département",
              error: err,
            });
          }

          idDepartement = insertDepartementResults.insertId;

          // Étape 3 : Insérer l'employé dans la table administration
          const query = `
          INSERT INTO administration (
            nom, prenom, age, sexe, situation, telephone, mail,
            id_departement, code_admin, diplome, date_e, id_salaire, profil, identite
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

          db.query(
            query,
            [
              nom,
              prenom,
              age,
              sexe,
              situation,
              mail,
              telephone,
              idDepartement, // Utiliser id_departement comme clé étrangère
              code_admin,
              diplome,
              date_e,
              idSalaire, // Utiliser id_salaire comme clé étrangère
              profil ? profil.path : null, // Assurez-vous que le chemin du fichier est correct
              identite ? identite.path : null, // Idem pour le fichier identite
            ],
            (err, results) => {
              if (err) {
                console.error("Erreur lors de l'insertion de l'employé:", err);
                return res.status(500).json({
                  message: "Erreur serveur lors de l'insertion de l'employé",
                  error: err,
                });
              }
              res.status(200).json({
                message: `${departement} ajouté avec succès !`,
              });
            }
          );
        }
      );
    } else {
      // Si le département existe déjà, on utilise son id
      idDepartement = departementResults[0].id_departement;

      // Étape 3 : Insérer l'employé dans la table administration
      const query = `
        INSERT INTO administration (
          nom, prenom, age, sexe, situation, telephone, mail, 
          id_departement, code_admin, diplome, date_e, id_salaire, profil, identite
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.query(
        query,
        [
          nom,
          prenom,
          age,
          sexe,
          situation,
          mail,
          telephone,
          idDepartement, // Utiliser id_departement comme clé étrangère
          code_admin,
          diplome,
          date_e,
          idSalaire, // Utiliser id_salaire comme clé étrangère
          profil ? profil.path : null, // Assurez-vous que le chemin du fichier est correct
          identite ? identite.path : null, // Idem pour le fichier identite
        ],
        (err, results) => {
          if (err) {
            console.error("Erreur lors de l'insertion de l'employé:", err);
            return res.status(500).json({
              message: "Erreur serveur lors de l'insertion de l'employé",
              error: err,
            });
          }
          res.status(200).json({
            message: `${departement} ajouté avec succès !`,
          });
        }
      );
    }
  });
}

// Votre route existante pour obtenir les données
app.get("/administration", (req, res) => {
  const query = `
    SELECT 
  a.id_admin, a.nom, a.prenom, a.age, a.sexe, a.date_e, a.telephone, a.mail, a.situation, 
  d.departement, a.nombre_consultation, a.code_admin, a.profil, a.identite, a.diplome, 
  s.salaire_brute 
FROM administration a
LEFT JOIN salaire s ON a.id_salaire = s.id_salaire
LEFT JOIN departements d ON a.id_departement = d.id_departement;
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Erreur lors de la récupération des données:", err);
      return res.status(500).json({ message: "Erreur serveur", error: err });
    }
    res.status(200).json(results);
  });
});

// Route d'authentification
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

// Clé secrète pour signer les JWT
const SECRET_KEY = "votre_cle_secrete";

// Endpoint d'authentification
app.post("/auth", (req, res) => {
  const code = req.body.code_admin;

  // Vérification si le code est fourni et valide
  if (!code || typeof code !== "string" || code.trim() === "") {
    logger.error("Code administrateur manquant ou invalide");
    return res
      .status(400)
      .json({ error: "Code administrateur manquant ou invalide" });
  }

  logger.info(`Code reçu : ${code}`);
  console.log(`Code reçu : ${code}`);

  // Requête pour récupérer l'utilisateur et le code_admin haché
  const query = `
    SELECT a.*, d.departement 
    FROM administration a 
    LEFT JOIN departements d ON a.id_departement = d.id_departement
  `;

  db.query(query, (err, results) => {
    if (err) {
      logger.error("Erreur lors de la requête SQL", { error: err });
      return res.status(500).json({ error: "Erreur interne du serveur" });
    }

    if (!Array.isArray(results) || results.length === 0) {
      logger.warn("Aucun administrateur trouvé dans la base de données");
      return res.json({ isValid: false });
    }

    // Vérification de chaque administrateur pour trouver une correspondance
    let foundAdmin = null;
    for (const admin of results) {
      if (!admin.code_admin || typeof admin.code_admin !== "string") {
        logger.error(
          `Code_admin invalide pour l'administrateur : ${admin.id_admin}`
        );
        continue; // Ignore cet administrateur
      }

      // Vérifier si le code saisi correspond au code haché
      if (bcrypt.compareSync(code, admin.code_admin)) {
        foundAdmin = admin;
        break;
      }
    }

    if (foundAdmin) {
      logger.info("Administrateur trouvé", { admin: foundAdmin });

      let redirectPage = "";
      switch (
        foundAdmin.departement // Correction ici
      ) {
        case "Administrateur":
          redirectPage = "/admin";
          break;
        case "Medecin généraliste":
          redirectPage = "/dog";
          break;
        case "Sage femme":
          redirectPage = "/sage";
          break;
        case "Échographiste":
          redirectPage = "/echo";
          break;
        case "Infirmier":
          redirectPage = "/infirm";
          break;
        case "Pharmacien":
          redirectPage = "/pharmacie";
          break;
        case "Secretaire Comptable":
          redirectPage = "/comptable";
          break;
        case "Interne/Garde":
          redirectPage = "/interne";
          break;
        default:
          redirectPage = "/infirm";
      }

      // Génération d'un JWT
      const token = jwt.sign(
        { idAdmin: foundAdmin.id_admin, departement: foundAdmin.departement },
        SECRET_KEY,
        { expiresIn: "1h" }
      );

      return res.json({
        isValid: true,
        redirectPage,
        token,
      });
    } else {
      logger.warn("Aucun administrateur trouvé pour ce code");
      return res.json({ isValid: false });
    }
  });
});

// Route pour récupérer les informations des employés avec leurs salaires
app.get("/employes", (req, res) => {
  // Requête SQL corrigée pour récupérer les informations sur les employés, leurs salaires et leurs départements
  const query = `
    SELECT 
      a.id_admin,
      a.nom,
      a.prenom,
      a.mail,
      a.telephone,
      s.salaire_brute,
      s.inps,
      s.amo,
      d.departement
    FROM 
      administration a
    LEFT JOIN 
      salaire s ON a.id_salaire = s.id_salaire
    LEFT JOIN 
      departements d ON a.id_departement = d.id_departement
  `;

  db.query(query, (error, results) => {
    if (error) {
      console.error(
        "Erreur lors de la récupération des employés, salaires et départements:",
        error
      );
      return res.status(500).json({ message: "Erreur serveur" });
    }

    // Retourner les informations sur les employés avec leurs salaires et départements
    res.status(200).json(results);
  });
});

app.get("/employe/:id", (req, res) => {
  const { id } = req.params;
  // Requête pour récupérer l'employé depuis la table 'administration', incluant 'id_salaire'
  const query =
    "SELECT id_salaire, telephone, mail FROM administration  WHERE id_admin = ?";
  db.query(query, [id], (err, result) => {
    if (err) {
      res.status(500).send("Erreur lors de la récupération de l'employé");
    } else {
      res.json(result[0]); // Renvoi de l'id_salaire de l'employé
    }
  });
});

app.get("/get_admin/:id", (req, res) => {
  const id = req.params.id;
  const sql = `
    SELECT a.*, s.salaire_brute, d.departement
    FROM administration a
    LEFT JOIN salaire s ON a.id_salaire = s.id_salaire
    LEFT JOIN departements d ON a.id_departement = d.id_departement
    WHERE a.id_admin = ?
  `;
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Erreur lors de la récupération des données :", err);
      res.status(500).json({ error: "Erreur serveur" });
    } else {
      res.json(result);
    }
  });
});

app.delete("/delete_admin/:id", (req, res) => {
  const id = req.params.id;
  const sql = "DELETE FROM administration WHERE id_admin=?";
  const values = [id];
  db.query(sql, values, (err, result) => {
    if (err)
      return res
        .status(500)
        .json({ message: "Une erreur inattendue est survenue: " + err });
    return res.status(200).json({ success: "Employé supprimée avec succès" });
  });
});

app.put(
  "/update_admin/:id",
  upload.fields([{ name: "profil" }, { name: "identite" }]),
  (req, res) => {
    const id = req.params.id; // Récupération de l'ID de l'employé à modifier
    const {
      nom,
      prenom,
      age,
      sexe,
      situation,
      telephone,
      mail,
      departement,
      code_admin,
      diplome,
      date_e,
      salaire_brute,
    } = req.body;

    const profil = req.files.profil ? req.files.profil[0] : null;
    const identite = req.files.identite ? req.files.identite[0] : null;

    // Vérifier si le salaire a changé
    if (salaire_brute) {
      const checkSalaireQuery = `SELECT id_salaire FROM salaire WHERE salaire_brute = ?`;

      db.query(checkSalaireQuery, [salaire_brute], (err, salaireResults) => {
        if (err) {
          console.error("Erreur lors de la vérification du salaire:", err);
          return res.status(500).json({
            message: "Erreur serveur lors de la vérification du salaire",
            error: err,
          });
        }

        let idSalaire;
        if (salaireResults.length === 0) {
          const inps = salaire_brute * 0.036;
          const amo = salaire_brute * 0.0306;

          const salaireQuery = `INSERT INTO salaire (salaire_brute, inps, amo) VALUES (?, ?, ?)`;
          db.query(
            salaireQuery,
            [salaire_brute, inps, amo],
            (err, salaireInsertResults) => {
              if (err) {
                console.error("Erreur lors de l'insertion du salaire:", err);
                return res.status(500).json({
                  message: "Erreur serveur lors de l'insertion du salaire",
                  error: err,
                });
              }
              idSalaire = salaireInsertResults.insertId;

              // Appel à la fonction de mise à jour de l'employé
              updateEmploye(
                id,
                idSalaire,
                departement,
                nom,
                prenom,
                age,
                sexe,
                situation,
                telephone,
                mail,
                code_admin,
                diplome,
                date_e,
                profil,
                identite,
                res
              );
            }
          );
        } else {
          idSalaire = salaireResults[0].id_salaire;

          // Appel à la fonction de mise à jour de l'employé
          updateEmploye(
            id,
            idSalaire,
            departement,
            nom,
            prenom,
            age,
            sexe,
            situation,
            telephone,
            mail,
            code_admin,
            diplome,
            date_e,
            profil,
            identite,
            res
          );
        }
      });
    } else {
      // Si le salaire n'a pas changé, on continue avec l'ID de salaire existant
      const getEmployeQuery = `SELECT id_salaire FROM administration WHERE id_admin = ?`;
      db.query(getEmployeQuery, [id], (err, employeResults) => {
        if (err) {
          console.error("Erreur lors de la récupération de l'employé:", err);
          return res.status(500).json({
            message: "Erreur serveur lors de la récupération de l'employé",
            error: err,
          });
        }

        const idSalaire = employeResults[0]?.id_salaire;
        updateEmploye(
          id,
          idSalaire,
          departement,
          nom,
          prenom,
          age,
          sexe,
          situation,
          telephone,
          mail,
          code_admin,
          diplome,
          date_e,
          profil,
          identite,
          res
        );
      });
    }
  }
);

// Fonction pour mettre à jour l'employé dans la table administration
function updateEmploye(
  id,
  idSalaire,
  departement,
  nom,
  prenom,
  age,
  sexe,
  situation,
  telephone,
  mail,
  code_admin,
  diplome,
  date_e,
  profil,
  identite,
  res
) {
  const departementQuery = `SELECT id_departement FROM departements WHERE departement = ?`;

  db.query(departementQuery, [departement], (err, departementResults) => {
    if (err) {
      console.error("Erreur lors de la vérification du département:", err);
      return res.status(500).json({
        message: "Erreur serveur lors de la vérification du département",
        error: err,
      });
    }

    let idDepartement;
    if (departementResults.length === 0) {
      const insertDepartementQuery = `INSERT INTO departements (departement) VALUES (?)`;
      db.query(
        insertDepartementQuery,
        [departement],
        (err, insertDepartementResults) => {
          if (err) {
            console.error("Erreur lors de l'insertion du département:", err);
            return res.status(500).json({
              message: "Erreur serveur lors de l'insertion du département",
              error: err,
            });
          }
          idDepartement = insertDepartementResults.insertId;
          // Mise à jour de l'employé dans la table administration
          updateEmployeInDb(
            id,
            idSalaire,
            idDepartement,
            nom,
            prenom,
            age,
            sexe,
            situation,
            telephone,
            mail,
            code_admin,
            diplome,
            date_e,
            profil,
            identite,
            res
          );
        }
      );
    } else {
      idDepartement = departementResults[0].id_departement;
      // Mise à jour de l'employé dans la table administration
      updateEmployeInDb(
        id,
        idSalaire,
        idDepartement,
        nom,
        prenom,
        age,
        sexe,
        situation,
        telephone,
        mail,
        code_admin,
        diplome,
        date_e,
        profil,
        identite,
        res
      );
    }
  });
}

// Fonction pour effectuer l'insertion dans la table administration
function updateEmployeInDb(
  id,
  idSalaire,
  idDepartement,
  nom,
  prenom,
  age,
  sexe,
  situation,
  telephone,
  mail,
  code_admin,
  diplome,
  date_e,
  profil,
  identite,
  res
) {
  const updateQuery = `
    UPDATE administration 
    SET nom = ?, prenom = ?, age = ?, sexe = ?, situation = ?, telephone = ?, mail = ?, 
    id_departement = ?, code_admin = ?, diplome = ?, date_e = ?, id_salaire = ?, profil = ?, identite = ?
    WHERE id_admin = ?
  `;

  // Vérifier si un nouveau code_admin est fourni
  if (code_admin) {
    bcrypt.hash(code_admin, 10, (err, hashedCode) => {
      if (err) {
        console.error("Erreur lors du hachage du code_admin:", err);
        return res.status(500).json({
          message: "Erreur serveur lors du hachage du code_admin",
          error: err,
        });
      }

      // Utiliser le code_admin haché dans la mise à jour
      db.query(
        updateQuery,
        [
          nom,
          prenom,
          age,
          sexe,
          situation,
          telephone,
          mail,
          idDepartement,
          hashedCode, // code_admin haché
          diplome,
          date_e,
          idSalaire,
          profil ? profil.path : null, // Si un nouveau fichier est envoyé, on l'enregistre
          identite ? identite.path : null, // Idem pour le fichier identite
          id,
        ],
        (err, results) => {
          if (err) {
            console.error("Erreur lors de la mise à jour de l'employé:", err);
            return res.status(500).json({
              message: "Erreur serveur lors de la mise à jour de l'employé",
              error: err,
            });
          }
          res.status(200).json({ message: "Employé mis à jour avec succès !" });
        }
      );
    });
  } else {
    // Si aucun nouveau code_admin n'est fourni, mise à jour sans hachage
    db.query(
      updateQuery,
      [
        nom,
        prenom,
        age,
        sexe,
        situation,
        telephone,
        mail,
        idDepartement,
        null, // Pas de modification pour code_admin
        diplome,
        date_e,
        idSalaire,
        profil ? profil.path : null, // Si un nouveau fichier est envoyé, on l'enregistre
        identite ? identite.path : null, // Idem pour le fichier identite
        id,
      ],
      (err, results) => {
        if (err) {
          console.error("Erreur lors de la mise à jour de l'employé:", err);
          return res.status(500).json({
            message: "Erreur serveur lors de la mise à jour de l'employé",
            error: err,
          });
        }
        res.status(200).json({ message: "Employé mis à jour avec succès !" });
      }
    );
  }
}

app.get("/historique-achat", (req, res) => {
  const query = `
    SELECT 
    h.id_achat,
    m.nom,
    m.forme,
    m.dosage,
    h.prix_achat,
    h.date_achat,
    h.quantite,
    h.fournisseur,
    h.num_fournisseur,
    (quantite * prix_achat) AS montant_achat
FROM 
    historique_achats h
JOIN 
    medicaments m
ON 
    h.id_medicament = m.id_medicament;
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error(
        "Erreur lors de la récupération de l'historique des achats:",
        err
      );
      return res
        .status(500)
        .json({ message: "Erreur lors de la récupération des données" });
    }

    res.status(200).json(results);
  });
});

app.get("/view/:id", (req, res) => {
  const id = req.params.id;
  const sql = "SELECT * FROM consultation WHERE id = ?";
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Erreur lors de la récupération des données :", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    if (result.length > 0) {
      return res.json(result[0]); // Renvoyer seulement le premier élément du tableau
    } else {
      return res.status(404).json({ error: "Patient non trouvé" });
    }
  });
});

app.get("/viewa/:id", (req, res) => {
  const id = req.params.id; // Utilise "id" comme défini dans l'URL
  const sql = "SELECT * FROM patient WHERE id_patient = ?";
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Erreur lors de la récupération des données :", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    if (result.length > 0) {
      return res.json(result[0]); // Renvoyer seulement le premier élément du tableau
    } else {
      return res.status(404).json({ error: "Patient non trouvé" });
    }
  });
});

{
  /* FIN ADMINISTRATION*/
}

{
  /* DEBUT COMPTE ADMINISTRATION*/
}

function getAdminById(idAdmin, res) {
  const sql = `SELECT nom, prenom, profil FROM administration WHERE id_admin = ?`;
  db.query(sql, [idAdmin], (err, result) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.status(500).json({ message: "Erreur serveur" });
    }
    if (result.length === 0) {
      return res
        .status(404)
        .json({ message: "Aucun administrateur trouvé avec cet ID" });
    }

    // Modifier le chemin pour utiliser l'URL publique
    const admin = result[0];
    const fileName = path.basename(admin.profil); // Extraire le nom du fichier
    admin.profil = `/images/${fileName}`; // Ajouter le chemin public

    res.json(admin);
  });
}

app.get("/admin/info/:idAdmin", (req, res) => {
  const idAdmin = req.params.idAdmin; // Récupérer l'ID du médecin connecté
  getAdminById(idAdmin, res);
});

app.get("/dog/info/:idAdmin", (req, res) => {
  const idAdmin = req.params.idAdmin; // Récupérer l'ID du médecin connecté
  getAdminById(idAdmin, res);
});

app.get("/echo/info/:idAdmin", (req, res) => {
  const idAdmin = req.params.idAdmin; // Récupérer l'ID du médecin connecté
  getAdminById(idAdmin, res);
});

app.get("/sage/info/:idAdmin", (req, res) => {
  const idAdmin = req.params.idAdmin; // Récupérer l'ID du médecin connecté
  getAdminById(idAdmin, res);
});

app.get("/infirm/info/:idAdmin", (req, res) => {
  const idAdmin = req.params.idAdmin; // Récupérer l'ID du médecin connecté
  getAdminById(idAdmin, res);
});

app.get("/interne/info/:idAdmin", (req, res) => {
  const idAdmin = req.params.idAdmin; // Récupérer l'ID du médecin connecté
  getAdminById(idAdmin, res);
});

app.get("/pharmacie/info/:idAdmin", (req, res) => {
  const idAdmin = req.params.idAdmin; // Récupérer l'ID du médecin connecté
  getAdminById(idAdmin, res);
});

app.get("/comptable/info/:idAdmin", (req, res) => {
  const idAdmin = req.params.idAdmin; // Récupérer l'ID du médecin connecté
  getAdminById(idAdmin, res);
});

{
  /* FIN COMPTE ADMINISTRATION*/
}

{
  /* DEBUT PATIENT*/
}

const createPDF = (
  facturePath,
  nom,
  prenom,
  type_soin,
  prix,
  age,
  localite,
  callback
) => {
  // Logique pour générer le PDF
  const PDFDocument = require("pdfkit");
  const fs = require("fs");

  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(facturePath));

  // Date actuelle
  const currentDate = new Date();
  const formattedDate = currentDate.toLocaleDateString(); // Formatage de la date (ex. : 09/12/2024)

  // Ajouter un titre en plus grand et en gras
  doc
    .fontSize(18)
    .text("Facture de consultation", { align: "center" })
    .moveDown(1); // Titre centré et espace après

  // Ajouter les autres informations
  doc.fontSize(12).text(`Facture pour ${prenom} ${nom}`);
  doc.text(`Type de soin : ${type_soin}`);
  doc.text(`Prix : ${prix} CFA`);
  doc.text(`Âge : ${age}`);
  doc.text(`Localité : ${localite}`);
  doc.text(`Date : ${formattedDate}`); // Affichage de la date

  doc.end();

  callback(null); // Appel du callback une fois le PDF généré
};

app.post("/add", (req, res) => {
  console.log("Données reçues :", req.body);
  const {
    telephone,
    nom,
    prenom,
    age,
    sexe,
    ethnie,
    localite,
    tension,
    type_soin,
    code_admin,
  } = req.body;

  // Vérification si le code est fourni et valide
  if (
    !code_admin ||
    typeof code_admin !== "string" ||
    code_admin.trim() === ""
  ) {
    console.error("Code administrateur manquant ou invalide");
    return res
      .status(400)
      .json({ error: "Code administrateur manquant ou invalide" });
  }

  // Récupérer tous les administrateurs depuis la base de données
  const getAdminsQuery = "SELECT id_admin, code_admin FROM administration";
  db.query(getAdminsQuery, (err, results) => {
    if (err) {
      console.error(
        "Erreur lors de la récupération des administrateurs :",
        err
      );
      return res.status(500).json({ error: "Erreur interne du serveur" });
    }

    let foundAdmin = null;
    for (const admin of results) {
      if (
        admin.code_admin &&
        bcrypt.compareSync(code_admin, admin.code_admin)
      ) {
        foundAdmin = admin;
        break;
      }
    }

    if (!foundAdmin) {
      console.error("Code administrateur incorrect");
      return res.status(401).json({ error: "Code administrateur incorrect" });
    }

    console.log("Administrateur validé :", foundAdmin.id_admin);

    // Vérifier l'ID du soin basé sur le type de soin
    const getIdSoinQuery = "SELECT id_soin FROM soins WHERE type_soin = ?";
    db.query(getIdSoinQuery, [type_soin], (err, results) => {
      if (err) {
        console.error("Erreur lors de la récupération du soin :", err);
        return res
          .status(500)
          .json({ error: "Erreur lors de la récupération du soin" });
      }

      if (results.length === 0) {
        console.error("Type de soin invalide :", type_soin);
        return res.status(400).json({ error: "Type de soin invalide" });
      }

      const id_soin = results[0].id_soin;
      console.log("ID du soin trouvé :", id_soin);

      // Mettre à jour le nombre de consultations
      const incrementConsultationsQuery =
        "UPDATE administration SET nombre_consultation = nombre_consultation + 1 WHERE id_admin = ?";
      db.query(incrementConsultationsQuery, [foundAdmin.id_admin], (err) => {
        if (err) {
          console.error(
            "Erreur lors de l'incrémentation des consultations :",
            err
          );
          return res
            .status(500)
            .json({ error: "Erreur lors de la mise à jour des consultations" });
        }

        console.log("Nombre de consultations mis à jour pour l'administrateur");

        // Ajouter le patient
        const addPatientQuery =
          "INSERT INTO patient (telephone, nom, prenom, age, sexe, ethnie, localite, tension, type_soin, code_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        const patientValues = [
          telephone,
          nom,
          prenom,
          age,
          sexe,
          ethnie,
          localite,
          tension,
          type_soin,
          foundAdmin.code_admin, // Utilisez le code haché ici
        ];
        db.query(addPatientQuery, patientValues, (err, result) => {
          if (err) {
            console.error("Erreur lors de l'ajout du patient :", err);
            return res
              .status(500)
              .json({ error: "Erreur lors de l'ajout du patient" });
          }

          console.log("Patient ajouté avec succès :", result.insertId);

          // Génération de la facture
          const patientId = result.insertId;
          const getPrixQuery = "SELECT prix FROM soins WHERE id_soin = ?";
          db.query(getPrixQuery, [id_soin], (err, prixResults) => {
            if (err || prixResults.length === 0) {
              console.error("Erreur lors de la récupération du prix :", err);
              return res
                .status(500)
                .json({ error: "Erreur lors de la récupération du prix" });
            }

            const prixFormate = parseFloat(prixResults[0].prix).toFixed(2);

            const facturePath = path.join(
              bureauPath,
              `${patientId}_facture.pdf`
            );
            createPDF(
              facturePath,
              nom,
              prenom,
              type_soin,
              prixFormate,
              age,
              localite,
              (err) => {
                if (err) {
                  console.error("Erreur lors de la génération du PDF :", err);
                  return res
                    .status(500)
                    .json({ error: "Erreur lors de la génération du PDF" });
                }

                console.log("Facture générée :", facturePath);

                // Ajouter le reçu
                const insertRecuQuery =
                  "INSERT INTO recu (id_patient, type_soin, id_soin, montant) VALUES (?, ?, ?, ?)";
                const recuValues = [patientId, type_soin, id_soin, prixFormate];
                db.query(insertRecuQuery, recuValues, (err) => {
                  if (err) {
                    console.error("Erreur lors de l'ajout du reçu :", err);
                    return res
                      .status(500)
                      .json({ error: "Erreur lors de l'ajout du reçu" });
                  }

                  res.json({
                    success: "Patient et reçu ajoutés avec succès",
                    facturePath,
                  });
                });
              }
            );
          });
        });
      });
    });
  });
});

function getPatientsByDepartement(departement, res) {
  const sql = `
    SELECT 
  p.id_patient, 
  p.nom, 
  p.prenom,
  p.age,
  p.sexe,
  p.ethnie,
  p.telephone,
  p.localite,
  p.tension,
  MAX(s.type_soin) AS type_soin
  FROM 
  patient p
JOIN 
      soins s ON p.type_soin = s.type_soin
    JOIN 
      administration a ON s.id_departement = a.id_departement
    JOIN 
      departements d ON a.id_departement = d.id_departement
    WHERE 
      d.departement IN (?)
    GROUP BY 
      p.id_patient;
  `;

  db.query(sql, [departement], (err, result) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.status(500).json({ message: "Erreur serveur" });
    }

    console.log("Résultats de la requête : ", result); // Log des résultats
    res.json(result); // Renvoie les résultats sous forme de JSON
  });
}

// Endpoints pour chaque département
app.get("/dog", (req, res) => {
  getPatientsByDepartement("Medecin généraliste", res);
});

app.get("/echo", (req, res) => {
  getPatientsByDepartement("Échographiste", res);
});

app.get("/sage", (req, res) => {
  getPatientsByDepartement("Sage femme", res);
});

app.get("/infirm/patient", (req, res) => {
  getPatientsByDepartement(["Infirmier", "Interne/Garde"], res);
});

app.get("/interne/patient", (req, res) => {
  getPatientsByDepartement(["Infirmier", "Interne/Garde"], res);
});

app.get("/admin", (req, res) => {
  const sql = `SELECT * FROM patient`;
  db.query(sql, (err, result) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.status(500).json({ message: "Erreur serveur" });
    }
    res.json(result); // Première réponse
  });
});

// Route GET pour récupérer les données du patient par son ID
app.get("/get_patient/:id", (req, res) => {
  const { id } = req.params;
  const query = "SELECT * FROM patient WHERE id_patient = ?";

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Erreur lors de la récupération du patient:", err);
      return res
        .status(500)
        .json({ message: "Erreur lors de la récupération du patient." });
    }
    if (result.length === 0) {
      return res.status(404).json({ message: "Patient non trouvé." });
    }
    return res.status(200).json(result[0]); // Retourne les données du patient
  });
});

app.get("/get_agenda/:id", (req, res) => {
  const id = req.params.id;
  const sql = "SELECT * FROM agenda WHERE id_agenda = ?";
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Erreur lors de la récupération des données :", err);
      res.status(500).json({ error: "Erreur serveur" });
    } else {
      res.json(result);
    }
  });
});

app.delete("/delete_patient/:id", (req, res) => {
  const id = req.params.id;
  console.log("ID reçu pour suppression :", id); // Vérifiez que l'ID est correct

  const sql = "DELETE FROM patient WHERE id_patient=?";
  const values = [id];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.status(500).json({ message: "Erreur interne", error: err });
    }

    console.log("Résultat de la requête :", result);

    if (result.affectedRows === 0) {
      console.warn("Aucune ligne affectée. Patient non trouvé.");
      return res.status(404).json({ message: "Patient non trouvé" });
    }

    console.log("Patient supprimé avec succès !");
    return res.status(200).json({ success: "Patient supprimé avec succès" });
  });
});

app.delete("/delete_agenda/:id", (req, res) => {
  const id = req.params.id;
  const sql = "DELETE FROM agenda WHERE id_agenda=?";
  const values = [id];
  db.query(sql, values, (err, result) => {
    if (err)
      return res.json({ message: "Something unexpected has occured" + err });
    return res.json({ success: "Student updated successfully" });
  });
});

{
  /* FIN PATIENT*/
}

{
  /* DEBUT CONSULATION*/
}

app.post("/add_consultation", (req, res) => {
  const {
    id_patient,
    nom,
    prenom,
    age,
    sexe,
    ethnie,
    telephone,
    localite,
    tension,
    type_soin, // Utilisation de type_soin ici
    diagnostique,
    prescription,
    id_admin,
  } = req.body;

  // Étape 1 : Récupérer le prix depuis la table soins en fonction de type_soin
  const getPrixQuery = "SELECT prix FROM soins WHERE type_soin = ?"; // Modification ici pour utiliser type_soin
  db.query(getPrixQuery, [type_soin], (err, result) => {
    if (err) {
      console.error("Erreur lors de la récupération du prix :", err);
      return res
        .status(500)
        .json({ error: "Erreur lors de la récupération du montant." });
    }

    if (result.length === 0) {
      return res.status(404).json({ error: "Type de soin introuvable." });
    }

    const montant = result[0].prix; // Récupération du prix

    // Étape 2 : Insérer la consultation dans la table consultation
    const insertConsultationQuery = `
      INSERT INTO consultation (
        id_patient, nom, prenom, age, sexe, ethnie, telephone, localite, tension,
        type_soin, diagnostique, prescription, montant, id_admin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const consultationValues = [
      id_patient,
      nom,
      prenom,
      age,
      sexe,
      ethnie,
      telephone,
      localite,
      tension,
      type_soin, // Envoi de type_soin pour la consultation
      diagnostique,
      prescription,
      montant, // Le prix récupéré est inséré ici
      id_admin,
    ];

    db.query(insertConsultationQuery, consultationValues, (insertErr) => {
      if (insertErr) {
        console.error(
          "Erreur lors de l'insertion de la consultation :",
          insertErr
        );
        return res
          .status(500)
          .json({ error: "Erreur lors de l'ajout de la consultation." });
      }

      // Étape 3 : Mettre à jour le nombre de consultations pour le médecin
      const updateMedecinQuery =
        "UPDATE administration SET nombre_consultation = nombre_consultation + 1 WHERE id_admin = ?";
      db.query(updateMedecinQuery, [id_admin], (updateErr) => {
        if (updateErr) {
          console.error(
            "Erreur lors de la mise à jour du médecin :",
            updateErr
          );
          return res
            .status(500)
            .json({ error: "Erreur lors de la mise à jour du médecin." });
        }

        // Étape 4 : Répondre avec succès après toutes les opérations
        res.status(200).json({
          message:
            "Consultation ajoutée et nombre de consultations mis à jour avec succès !",
        });
      });
    });
  });
});

function getConsultationByDepartement(departement, res) {
  const sql = `
    SELECT 
      c.* -- Sélectionne toutes les colonnes de la table consultation
    FROM 
      consultation c
    JOIN 
      administration a ON c.id_admin = a.id_admin
    JOIN 
      departements d ON a.id_departement = d.id_departement
    WHERE 
      d.departement IN (?)
  `;

  db.query(sql, [departement], (err, result) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.status(500).json({ message: "Erreur serveur" });
    }

    if (result.length === 0) {
      return res
        .status(404)
        .json({ message: "Aucune consultation trouvée pour ce département" });
    }

    console.log("Résultats de la requête : ", result);
    res.json(result);
  });
}

app.get("/dog/arch", (req, res) => {
  getConsultationByDepartement("Medecin généraliste", res);
});

app.get("/sage/arch", (req, res) => {
  getConsultationByDepartement("Sage femme", res);
});

app.get("/echo/arch", (req, res) => {
  getConsultationByDepartement("Échographiste", res);
});

app.get("/infirm/arch", (req, res) => {
  getConsultationByDepartement(["Infirmier", "Interne/Garde"], res);
});

app.get("/admin/arch", (req, res) => {
  const sql = `SELECT * FROM consultation`;
  db.query(sql, (err, result) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.status(500).json({ message: "Erreur serveur" });
    }
    res.json(result);
  });
});

{
  /* FIN CONSULATION*/
}

{
  /* DEBUT AGENDA*/
}

// Route POST pour insérer dans l'agenda
app.post("/add_agenda", (req, res) => {
  const {
    id_patient,
    nom,
    prenom,
    age,
    sexe,
    ethnie,
    telephone,
    localite,
    tension,
    type_soin,
    diagnostique,
    prescription,
    id_admin,
    date,
    heure,
  } = req.body;
  // Vérification des données
  if (!id_patient || !nom || !prenom || !date || !heure) {
    return res.status(400).json({
      message: "Toutes les informations nécessaires ne sont pas fournies.",
    });
  }
  // Requête SQL pour insérer dans l'agenda
  const queryAgenda = `
    INSERT INTO agenda (id_patient, nom, prenom, age, sexe, ethnie, telephone, localite, tension, type_soin, diagnostique, prescription, id_admin, date, heure)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  db.query(
    queryAgenda,
    [
      id_patient,
      nom,
      prenom,
      age,
      sexe,
      ethnie,
      telephone,
      localite,
      tension,
      type_soin,
      diagnostique,
      prescription,
      id_admin,
      date,
      heure,
    ],
    (err, result) => {
      if (err) {
        console.error("Erreur lors de l'insertion dans agenda:", err);
        return res
          .status(500)
          .json({ message: "Erreur lors de l'insertion dans agenda." });
      }

      console.log("Données insérées dans agenda:", result);

      // Si l'insertion est réussie, supprimer les données du patient de la table patient
      const queryDeletePatient = "DELETE FROM patient WHERE id_patient = ?";
      db.query(queryDeletePatient, [id_patient], (errDelete) => {
        if (errDelete) {
          console.error("Erreur lors de la suppression du patient:", errDelete);
          return res
            .status(500)
            .json({ message: "Erreur lors de la suppression du patient." });
        }

        console.log("Patient supprimé de la table patient");
        return res.status(200).json({
          message:
            "Données insérées dans l'agenda et patient supprimé avec succès.",
        });
      });
    }
  );
});
// Route PUT pour Mettre à jour dans l'agenda
app.put("/update_agenda/:id", (req, res) => {
  const {
    nom,
    prenom,
    age,
    sexe,
    ethnie,
    telephone,
    localite,
    tension,
    diagnostique,
    prescription,
    id_admin,
    id_patient,
    date,
    heure,
    id_agenda,
  } = req.body;

  const updateQuery = `
    UPDATE agenda
    SET 
      diagnostique = ?, 
      prescription = ?, 
      date = ?, 
      heure = ?, 
      nom = ?, 
      prenom = ?, 
      age = ?, 
      sexe = ?, 
      ethnie = ?, 
      telephone = ?, 
      localite = ?, 
      tension = ?, 
      id_admin = ?, 
      id_patient = ?
    WHERE id_agenda = ?`;

  db.query(
    updateQuery,
    [
      diagnostique,
      prescription,
      date,
      heure,
      nom,
      prenom,
      age,
      sexe,
      ethnie,
      telephone,
      localite,
      tension,
      id_admin,
      id_patient,
      id_agenda,
    ],
    (err, updateResults) => {
      if (err) {
        console.error("Erreur lors de la mise à jour de l'agenda :", err);
        return res.status(500).json({
          error: "Erreur lors de la mise à jour de l'agenda.",
          details: err.message,
        });
      }

      console.log("Mise à jour de l'agenda réussie :", updateResults);
      res.status(200).json({ message: "Agenda mis à jour avec succès !" });
    }
  );
});

function getAgendaByDepartement(departement, res) {
  const sql = `
    SELECT 
      a.* -- Sélectionne toutes les colonnes de la table consultation
    FROM 
      agenda a
    JOIN 
      administration b ON a.id_admin = b.id_admin
    JOIN 
      departements d ON b.id_departement = d.id_departement
    WHERE 
      d.departement IN (?)
  `;

  db.query(sql, [departement], (err, result) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.status(500).json({ message: "Erreur serveur" });
    }

    if (result.length === 0) {
      return res
        .status(404)
        .json({ message: "Aucune consultation trouvée pour ce département" });
    }

    console.log("Résultats de la requête : ", result);
    res.json(result);
  });
}

app.get("/dog/agenda", (req, res) => {
  getAgendaByDepartement("Medecin généraliste", res);
});

app.get("/sage/agenda", (req, res) => {
  getAgendaByDepartement("Sage femme", res);
});

app.get("/echo/agenda", (req, res) => {
  getAgendaByDepartement("Échographiste", res);
});

app.get("/infirm/agenda", (req, res) => {
  getAgendaByDepartement(["Infirmier", "Interne/Garde"], res);
});

app.get("/interne/agenda", (req, res) => {
  getAgendaByDepartement(["Infirmier", "Interne/Garde"], res);
});

app.get("/admin/agenda", (req, res) => {
  const sql = `SELECT * FROM agenda`;
  db.query(sql, (err, result) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.status(500).json({ message: "Erreur serveur" });
    }
    res.json(result);
  });
});

{
  /* FIN AGENDA*/
}

{
  /* DEBUT Salaire*/
}

app.post("/paiement", async (req, res) => {
  const { id_admin, salaire_brute, sur_salaire, prime, avance, its } = req.body;

  // Récupérer les informations de salaire depuis la table 'salaire' pour AMO et INPS
  const querySalaire =
    "SELECT id_salaire, amo, inps FROM salaire WHERE salaire_brute = ?";

  db.query(querySalaire, [salaire_brute], async (err, salaireResults) => {
    if (err) {
      console.error("Erreur lors de la récupération du salaire:", err);
      return res.status(500).json({ message: "Erreur serveur", error: err });
    }

    if (salaireResults.length === 0) {
      return res
        .status(400)
        .json({ message: "Le salaire brut spécifié n'existe pas." });
    }

    const salaireData = salaireResults[0];
    const idSalaire = salaireData.id_salaire;
    const amo = salaireData.amo;
    const inps = salaireData.inps;

    // Calcul du salaire net
    const net = salaire_brute + sur_salaire + prime - inps - amo - avance - its;

    // Récupérer le nom et le prénom de l'employé
    const queryAdmin =
      "SELECT nom, prenom, telephone, mail FROM administration WHERE id_admin = ?";
    db.query(queryAdmin, [id_admin], async (err, adminResults) => {
      if (err) {
        console.error(
          "Erreur lors de la récupération des informations de l'employé:",
          err
        );
        return res.status(500).json({ message: "Erreur serveur", error: err });
      }

      if (adminResults.length === 0) {
        return res
          .status(400)
          .json({ message: "L'employé avec cet ID n'existe pas." });
      }

      const adminData = adminResults[0];
      const nomEmploye = adminData.nom;
      const prenomEmploye = adminData.prenom;
      const telephoneEmploye = adminData.telephone;
      const mailEmploye = adminData.mail;

      // Vérifier si l'employé a une avance dans la table 'avance_salaire'
      const queryAvance =
        "SELECT * FROM avance_salaire WHERE id_admin = ? AND montant_avance > 0";
      db.query(queryAvance, [id_admin], async (err, avanceResults) => {
        if (err) {
          console.error("Erreur lors de la récupération de l'avance:", err);
          return res
            .status(500)
            .json({ message: "Erreur serveur", error: err });
        }

        let avanceMontant = 0;
        if (avanceResults.length > 0) {
          avanceMontant = avanceResults[0].montant_avance;
        }

        // Soustraire l'avance du montant net à payer
        const montantApayer = net - avanceMontant;
        const montatTotal = salaire_brute + prime + sur_salaire;

        // Vérifier si un paiement a déjà été effectué
        const queryCheckPaiement = `
          SELECT * FROM paiement 
          WHERE id_admin = ? 
          AND MONTH(date_paiement) = MONTH(CURRENT_DATE()) 
          AND YEAR(date_paiement) = YEAR(CURRENT_DATE())
        `;

        db.query(queryCheckPaiement, [id_admin], async (err, result) => {
          if (err) {
            console.error("Erreur lors de la vérification du paiement:", err);
            return res
              .status(500)
              .json({ message: "Erreur serveur", error: err });
          }

          if (result.length > 0) {
            return res.status(400).json({
              message:
                "Un paiement a déjà été effectué ce mois-ci pour cet employé.",
            });
          }

          // Formater la date
          const datePaiement = new Date();
          const dateStr = datePaiement.toISOString().split("T")[0]; // Format 'YYYY-MM-DD'
          const fichePath = path.join(
            os.homedir(),
            "Desktop",
            "fiche_paie",
            `fiche_paie_${id_admin}_${dateStr}.pdf`
          );

          // Générer la fiche de paie en HTML
          const htmlContent = `
  <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 40px;
        }
        .title {
          text-align: center;
          font-size: 24px;
          margin-bottom: 20px;
          background-color: #28a745; /* Fond vert */
          color: white;
          padding: 10px;
          width: 100%; /* Pour que le fond couvre toute la largeur */
          box-sizing: border-box; /* Pour inclure le padding dans la largeur totale */
        }
        .section {
          margin-bottom: 20px;
        }
        .section p {
          margin: 5px 0;
        }
        .section strong {
          width: 150px;
          display: inline-block;
        }
        .employee-info {
          display: flex;
          justify-content: space-between;
          padding: 10px;
          border: 2px solid #ddd;
          border-radius: 5px;
          margin-bottom: 10px;
        }
        .employee-info div {
          width: 48%;
        }
        .employee-info div.phone {
          margin-top: 10px;
        }
        .salary-info {
          margin-top: 20px;
          background-color: #28a745; /* Fond vert */
          color: white;
          padding: 10px;
          text-align: center;
          width: 100%; /* Pour que le fond couvre toute la largeur */
          box-sizing: border-box; /* Pour inclure le padding dans la largeur totale */
        }
        .footer {
          text-align: center;
          margin-top: 40px;
          font-size: 14px;
        }
        /* Ajout du fond vert uniquement pour Salaire Brut et Salaire Net */
        .salary-line {
          background-color: #28a745; /* Fond vert */
          color: white;
          padding: 5px 10px;
          margin-bottom: 10px;
        }
      </style>
    </head>
    <body>
      <div class="title">
        <h1>Fiche de Paie</h1>
      </div>
  
      <div class="section">
        <div class="employee-info">
          <div>
            <p><strong>Nom de l'employé:</strong> ${nomEmploye} ${prenomEmploye}</p>
          </div>
          <div>
            <p><strong>Email:</strong> ${mailEmploye}</p>
          </div>
        </div>
  
        <div class="employee-info">
          <div>
            <p><strong>Téléphone:</strong> ${telephoneEmploye}</p>
          </div>
        </div>
      </div>
  
      <div class="section">
        <div class="salary-line">
          <p><strong>Salaire Brut:</strong> ${salaire_brute} FCFA</p>
        </div>
        <p><strong>Sur-salaire:</strong> ${sur_salaire} FCFA</p>
        <p><strong>Prime:</strong> ${prime} FCFA</p>
        <p><strong>Avance:</strong> ${avance} FCFA</p>
        <p><strong>AMO:</strong> ${amo} FCFA</p>
        <p><strong>INPS:</strong> ${inps} FCFA</p>
        <p><strong>ITS:</strong> ${its} FCFA</p>
        <div class="salary-line">
          <p><strong>Salaire Net:</strong> ${net} FCFA</p>
        </div>
      </div>
  
      <div class="salary-info">
        <p><strong>Montant total payé par l'employeur :</strong> ${montatTotal} FCFA</p>
      </div>
  
      <div class="footer">
        <p>Date de paiement : ${dateStr}.</p>
      </div>
    </body>
  </html>
`;

          const browser = await puppeteer.launch();
          const page = await browser.newPage();
          await page.setContent(htmlContent);
          await page.pdf({ path: fichePath, format: "A4" });

          await browser.close();

          // Insérer le paiement dans la table 'paiement'
          const queryInsertPaiement = `
            INSERT INTO paiement 
            (id_salaire, id_admin, sur_salaire, prime, inps, amo, its, avance, net, date_paiement)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          db.query(
            queryInsertPaiement,
            [
              idSalaire, // id_salaire
              id_admin, // id_admin
              sur_salaire,
              prime,
              inps,
              amo,
              its,
              avanceMontant,
              net,
              datePaiement,
            ],
            (err, result) => {
              if (err) {
                console.error("Erreur lors de l'insertion du paiement:", err);
                return res.status(500).json({
                  message: "Erreur serveur lors de l'insertion du paiement",
                  error: err,
                });
              }

              // Renvoyer la fiche de paie générée au frontend
              res.status(200).json({
                message: "Paiement effectué avec succès",
                fichePaieUrl: fichePath, // URL du fichier généré pour téléchargement
              });
            }
          );

          await browser.close(); // Fermer le navigateur Puppeteer
        });
      });
    });
  });
});

app.post("/avance_salaire", (req, res) => {
  // Récupérer les données envoyées dans le body de la requête
  const { id_admin, montant_avance, date_avance } = req.body;

  // Vérifier si l'employé existe dans la table 'administration'
  const queryVerifAdmin = "SELECT * FROM administration WHERE id_admin = ?";

  db.query(queryVerifAdmin, [id_admin], (err, results) => {
    if (err) {
      console.error("Erreur lors de la vérification de l'employé:", err);
      return res.status(500).json({ message: "Erreur serveur", error: err });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Employé introuvable." });
    }

    // Si l'employé existe, insérer l'avance dans la table 'avance_salaire'
    const queryInsertAvance = `
      INSERT INTO avance_salaire (id_admin, montant_avance, date_avance)
      VALUES (?, ?, ?)
    `;

    db.query(
      queryInsertAvance,
      [id_admin, montant_avance, date_avance],
      (err, result) => {
        if (err) {
          console.error("Erreur lors de l'ajout de l'avance:", err);
          return res.status(500).json({
            message: "Erreur serveur lors de l'ajout de l'avance",
            error: err,
          });
        }

        res.status(200).json({
          message: "Avance ajoutée avec succès.",
          id_avance: result.insertId,
        });
      }
    );
  });
});

// Nouvelle route pour récupérer les informations salariales basées sur l'id_admin
app.get("/salaire/:id", (req, res) => {
  const { id } = req.params;

  // Requête pour récupérer l'id_salaire depuis la table administration
  const queryAdmin = "SELECT id_salaire FROM administration WHERE id_admin = ?";

  db.query(queryAdmin, [id], (err, result) => {
    if (err) {
      res
        .status(500)
        .send(
          "Erreur lors de la récupération de l'ID salaire depuis administration"
        );
    } else if (result.length === 0) {
      res.status(404).send("Aucun salaire trouvé pour cet employé");
    } else {
      const idSalaire = result[0].id_salaire;

      // Requête pour récupérer les informations salariales depuis la table salaire
      const querySalaire =
        "SELECT salaire_brute, amo, inps FROM salaire WHERE id_salaire = ?";
      db.query(querySalaire, [idSalaire], (err, result) => {
        if (err) {
          res
            .status(500)
            .send("Erreur lors de la récupération des informations salariales");
        } else if (result.length === 0) {
          res.status(404).send("Informations salariales introuvables");
        } else {
          res.json(result[0]); // Renvoi des données salariales
        }
      });
    }
  });
});

// Route pour récupérer l'avance d'un employé
app.get("/avance_salaire/:id", (req, res) => {
  const employeId = req.params.id;

  // Requête pour récupérer l'avance d'un employé
  const query = "SELECT montant_avance FROM avance_salaire WHERE id_admin = ?";

  db.query(query, [employeId], (err, result) => {
    if (err) {
      console.error("Erreur lors de la récupération de l'avance:", err);
      return res.status(500).send("Erreur interne du serveur");
    }

    if (result.length === 0) {
      // Si aucune avance n'est trouvée, renvoyer une avance de 0
      return res.json({ avance: 0 });
    }

    // Si l'avance est trouvée, renvoyer l'avance
    return res.json({ avance: result[0].montant_avance });
  });
});

// Route GET pour récupérer toutes les informations de la table "salaire"
app.get("/salaire", (req, res) => {
  const query = "SELECT * FROM salaire";

  db.query(query, (err, results) => {
    if (err) {
      console.error(
        "Erreur lors de la récupération des données de la table salaire :",
        err
      );
      res
        .status(500)
        .json({ error: "Erreur lors de la récupération des données" });
      return;
    }

    res.status(200).json(results);
  });
});

app.get("/get_salaire/:id", (req, res) => {
  const { id } = req.params;
  const query = "SELECT * FROM salaire WHERE id_salaire = ?";

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Erreur lors de la récupération du salaire:", err);
      return res
        .status(500)
        .json({ message: "Erreur lors de la récupération du salaire." });
    }
    if (result.length === 0) {
      return res.status(404).json({ message: "salaire non trouvé." });
    }
    return res.status(200).json(result[0]); // Retourne les données du salaire
  });
});

app.put("/update_salaire/:id", (req, res) => {
  const { salaire_base, salaire_brute, inps, amo } = req.body;

  const id_salaire = req.params.id; // Récupérer l'identifiant depuis les paramètres

  // Vérifier que l'identifiant est bien défini
  if (!id_salaire) {
    return res
      .status(400)
      .json({ message: "L'identifiant du salaire est requis." });
  }

  const updateQuery = `
    UPDATE salaire
    SET 
      salaire_base = ?, 
      salaire_brute = ?, 
      inps = ?, 
      amo = ?, 
    WHERE id_salaire = ?
  `;

  db.query(
    updateQuery,
    [
      salaire_base,
      salaire_brute,
      inps,
      amo,
      id_salaire, // Ajouter l'identifiant en dernier
    ],
    (err, updateResults) => {
      if (err) {
        console.error("Erreur lors de la mise à jour du salaire :", err);
        return res.status(500).json({
          error: "Erreur lors de la mise à jour du salaire.",
          details: err.message,
        });
      }

      res.status(200).json({ message: "Salaire mis à jour avec succès !" });
    }
  );
});

{
  /* FIN Salaire*/
}

{
  /* DEBUT Pharmacie*/
}

app.post("/add-medicament", async (req, res) => {
  const {
    nom,
    forme,
    dosage,
    posologie,
    stock_courant,
    prix_achat,
    prix_unitaire,
    date_achat,
    date_peremption,
    fournisseur,
    num_fournisseur,
  } = req.body;

  try {
    // Vérifier si le médicament existe déjà
    db.query(
      `SELECT * FROM medicaments WHERE nom = ? AND forme = ? AND dosage = ?`,
      [nom, forme, dosage],
      async (err, results) => {
        if (err) {
          console.error(
            "Erreur lors de la vérification du médicament existant",
            err
          );
          return res
            .status(500)
            .send("Erreur lors de la vérification du médicament.");
        }

        if (results.length > 0) {
          // Si le médicament existe déjà, on met à jour le stock
          const idMedicament = results[0].id_medicament;

          // Mise à jour dans la table `stock_medicaments`
          db.query(
            `UPDATE stock_medicaments 
                       SET stock_courant = ?, prix_achat = ?, prix_unitaire = ?, date_achat = ?, date_peremption = ?
                       WHERE id_medicament = ?`,
            [
              stock_courant,
              prix_achat,
              prix_unitaire,
              date_achat,
              date_peremption,
              idMedicament,
            ],
            (err, updateResult) => {
              if (err) {
                console.error("Erreur lors de la mise à jour du stock", err);
                return res
                  .status(500)
                  .send("Erreur lors de la mise à jour du stock.");
              }

              // Insertion dans l'historique des achats
              db.query(
                `INSERT INTO historique_achats (id_medicament, quantite, prix_achat, date_achat, fournisseur, num_fournisseur) 
                               VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  idMedicament,
                  stock_courant,
                  prix_achat,
                  date_achat,
                  fournisseur,
                  num_fournisseur,
                ],
                (err, insertResult) => {
                  if (err) {
                    console.error(
                      "Erreur lors de l'insertion dans l'historique des achats",
                      err
                    );
                    return res
                      .status(500)
                      .send(
                        "Erreur lors de l'insertion dans l'historique des achats."
                      );
                  }

                  return res
                    .status(200)
                    .send(
                      "Médicament mis à jour avec succès et historique enregistré."
                    );
                }
              );
            }
          );
        } else {
          // Sinon, on insère un nouveau médicament
          db.query(
            `INSERT INTO medicaments (nom, forme, dosage, posologie) 
                      VALUES (?, ?, ?, ?)`,
            [nom, forme, dosage, posologie],
            (err, medicamentsResult) => {
              if (err) {
                console.error("Erreur lors de l'ajout du médicament", err);
                return res
                  .status(500)
                  .send("Erreur lors de l'ajout du médicament.");
              }

              const idMedicament = medicamentsResult.insertId;

              db.query(
                `INSERT INTO stock_medicaments (id_medicament, stock_courant, prix_achat, prix_unitaire, date_achat, date_peremption) 
                              VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  idMedicament,
                  stock_courant,
                  prix_achat,
                  prix_unitaire,
                  date_achat,
                  date_peremption,
                ],
                (err, insertStockResult) => {
                  if (err) {
                    console.error("Erreur lors de l'ajout du stock", err);
                    return res
                      .status(500)
                      .send("Erreur lors de l'ajout du stock.");
                  }

                  // Insertion dans l'historique des achats
                  db.query(
                    `INSERT INTO historique_achats (id_medicament, quantite, prix_achat, date_achat, fournisseur, num_fournisseur) 
                                       VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                      idMedicament,
                      stock_courant,
                      prix_achat,
                      date_achat,
                      fournisseur,
                      num_fournisseur,
                    ],
                    (err, insertHistoryResult) => {
                      if (err) {
                        console.error(
                          "Erreur lors de l'insertion dans l'historique des achats",
                          err
                        );
                        return res
                          .status(500)
                          .send(
                            "Erreur lors de l'insertion dans l'historique des achats."
                          );
                      }

                      return res
                        .status(200)
                        .send(
                          "Médicament ajouté avec succès et historique enregistré."
                        );
                    }
                  );
                }
              );
            }
          );
        }
      }
    );
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur lors de l'ajout du médicament.");
  }
});

app.post("/ajouter-medicament", (req, res) => {
  let {
    nom,
    forme,
    dosage,
    posologie,
    stock_courant,
    prix_unitaire,
    date_peremption,
    prix_achat,
    date_achat,
    fournisseur,
    num_fournisseur,
  } = req.body;

  // Convertir les champs texte en minuscules
  nom = nom.toLowerCase();
  forme = forme.toLowerCase();
  dosage = dosage.toLowerCase();
  posologie = posologie.toLowerCase();
  fournisseur = fournisseur.toLowerCase();

  // Étape 1 : Vérifier si le médicament existe dans "médicaments"
  const checkMedicamentQuery = `SELECT id_medicament FROM medicaments WHERE nom = ? AND forme = ? AND dosage = ? AND posologie = ?`;
  const checkValues = [nom, forme, dosage, posologie];

  db.query(checkMedicamentQuery, checkValues, (err, results) => {
    if (err) {
      console.error("Erreur lors de la vérification du médicament:", err);
      return res
        .status(500)
        .json({ message: "Erreur lors de la vérification du médicament" });
    }

    let id_medicament;

    if (results.length > 0) {
      // Si le médicament existe, récupérer son id
      id_medicament = results[0].id_medicament;
      checkAndUpdateStock(id_medicament);
    } else {
      // Sinon, insérer dans la table "médicaments" et récupérer l'id_medicament
      const insertMedicamentQuery = `INSERT INTO medicaments (nom, forme, dosage, posologie) VALUES (?, ?, ?, ?)`;
      db.query(insertMedicamentQuery, checkValues, (err, insertResult) => {
        if (err) {
          console.error("Erreur lors de l'insertion du médicament:", err);
          return res
            .status(500)
            .json({ message: "Erreur lors de l'insertion du médicament" });
        }

        id_medicament = insertResult.insertId;
        checkAndUpdateStock(id_medicament);
      });
    }
  });

  // Étape 2 : Vérifier ou mettre à jour le stock dans "stock_medicament"
  function checkAndUpdateStock(id_medicament) {
    const checkStockQuery = `SELECT * FROM stock_medicaments WHERE nom = ? AND forme = ? AND dosage = ?`;
    const checkStockValues = [nom, forme, dosage];

    db.query(checkStockQuery, checkStockValues, (err, results) => {
      if (err) {
        console.error("Erreur lors de la vérification du stock:", err);
        return res
          .status(500)
          .json({ message: "Erreur lors de la vérification du stock" });
      }

      if (results.length > 0) {
        // Si le médicament existe déjà dans le stock, mettre à jour les champs
        const updateStockQuery = `
  UPDATE stock_medicaments
  SET stock_courant = stock_courant + ?, posologie = ?, prix_unitaire = ?, date_peremption = ?, prix_achat = ?, date_achat = ?
  WHERE nom = ? AND forme = ? AND dosage = ?`;
        const updateValues = [
          stock_courant,
          posologie,
          prix_unitaire,
          date_peremption,
          prix_achat,
          date_achat,
          nom,
          forme,
          dosage,
        ];

        db.query(updateStockQuery, updateValues, (err, result) => {
          if (err) {
            console.error("Erreur lors de la mise à jour du stock:", err);
            return res
              .status(500)
              .json({ message: "Erreur lors de la mise à jour du stock" });
          }

          // Enregistrer l'opération dans historique_achats
          logToHistorique(id_medicament);

          res
            .status(200)
            .json({ message: "Médicament et stock mis à jour avec succès" });
        });
      } else {
        // Sinon, insérer dans "stock_medicaments"
        const insertStockQuery = `
          INSERT INTO stock_medicaments 
          (id_medicament, nom, forme, dosage, posologie, stock_courant, prix_unitaire, date_peremption, prix_achat, date_achat) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const insertValues = [
          id_medicament,
          nom,
          forme,
          dosage,
          posologie,
          stock_courant,
          prix_unitaire,
          date_peremption,
          prix_achat,
          date_achat,
        ];

        db.query(insertStockQuery, insertValues, (err, result) => {
          if (err) {
            console.error(
              "Erreur lors de l'insertion dans stock_medicament:",
              err
            );
            return res.status(500).json({
              message: "Erreur lors de l'insertion dans stock_medicament",
            });
          }

          // Enregistrer l'opération dans historique_achats
          logToHistorique(id_medicament);

          res
            .status(200)
            .json({ message: "Médicament ajouté avec succès dans le stock" });
        });
      }
    });
  }

  // Étape 3 : Enregistrer dans "historique_achats"
  function logToHistorique(id_medicament) {
    const insertHistoriqueQuery = `
      INSERT INTO historique_achats 
      (id_medicament, prix_achat, date_achat, quantite, fournisseur, num_fournisseur) 
      VALUES (?, ?, ?, ?, ?, ?)`;

    const insertHistoriqueValues = [
      id_medicament,
      prix_achat,
      date_achat,
      stock_courant, // Quantité ajoutée ou mise à jour
      fournisseur,
      num_fournisseur,
    ];

    db.query(insertHistoriqueQuery, insertHistoriqueValues, (err, result) => {
      if (err) {
        console.error(
          "Erreur lors de l'enregistrement dans historique_achats:",
          err
        );
        // Pas de retour ici pour ne pas interrompre la logique principale
      } else {
        console.log("Enregistrement effectué dans historique_achats.");
      }
    });
  }
});

app.post("/effectuer-vente", (req, res) => {
  const medicaments = req.body.medicaments; // Assurez-vous que les médicaments sont dans cette clé
  const code_admin = req.body.code_admin; // Récupérer code_admin du formulaire
  const mode_paiement = req.body.mode_paiement; // Récupérer mode_paiement du formulaire

  // 1. Vérification des données reçues
  if (!medicaments || medicaments.length === 0) {
    return res.status(400).json({ message: "Aucun médicament fourni." });
  }

  if (
    !code_admin ||
    typeof code_admin !== "string" ||
    code_admin.trim() === ""
  ) {
    return res
      .status(400)
      .json({ message: "Le code administrateur est requis." });
  }

  if (!mode_paiement) {
    return res.status(400).json({ message: "Le mode de paiement est requis." });
  }

  console.log("Médicaments reçus :", medicaments);
  console.log("Code administrateur reçu :", code_admin);
  console.log("Mode de paiement reçu :", mode_paiement);

  // 2. Vérifier que le code_admin existe dans la base de données
  const getAdminsQuery = "SELECT id_admin, code_admin FROM administration";
  db.query(getAdminsQuery, (err, results) => {
    if (err) {
      console.error(
        "Erreur lors de la récupération des administrateurs :",
        err
      );
      return res.status(500).json({ error: "Erreur interne du serveur" });
    }

    let foundAdmin = null;
    for (const admin of results) {
      if (
        admin.code_admin &&
        bcrypt.compareSync(code_admin, admin.code_admin)
      ) {
        foundAdmin = admin;
        break;
      }
    }

    if (!foundAdmin) {
      console.error("Code administrateur incorrect");
      return res.status(401).json({ error: "Code administrateur incorrect" });
    }

    console.log("Administrateur validé :", foundAdmin.id_admin);

    // 3. Vérification si medicaments est un tableau
    if (!Array.isArray(medicaments)) {
      return res.status(400).json({
        message: "Les médicaments doivent être envoyés sous forme de tableau.",
      });
    }

    // 4. Filtrer les médicaments valides
    const medicamentsValides = medicaments.filter((med) => med.id_medicament);
    if (medicamentsValides.length === 0) {
      return res.status(400).json({
        message: "Aucun médicament valide fourni (id_medicament manquant).",
      });
    }

    // 5. Calcul du montant total global pour la vente
    const montant_total = medicamentsValides.reduce((sum, med) => {
      const montant = (med.quantite_vendue || 0) * (med.prix_unitaire || 0);
      return sum + montant;
    }, 0);

    console.log("Montant total de la vente :", montant_total);

    // 6. Début de transaction
    db.beginTransaction((err) => {
      if (err) {
        console.error("Erreur début de transaction :", err);
        return res
          .status(500)
          .json({ message: "Erreur de transaction.", error: err });
      }

      // 7. Insertion dans la table vente avec mode_paiement
      const venteQuery =
        "INSERT INTO vente (montant_total, code_admin, mode_paiement) VALUES (?, ?, ?)";
      db.query(
        venteQuery,
        [montant_total, foundAdmin.code_admin, mode_paiement],
        (err, result) => {
          if (err) {
            console.error("Erreur insertion vente :", err);
            return db.rollback(() => {
              res.status(500).json({
                message: "Erreur lors de l'insertion de la vente.",
                error: err,
              });
            });
          }

          const id_vente = result.insertId; // Récupération de l'ID de vente
          console.log("ID de la vente :", id_vente);

          // Incrémenter nombre_consultation pour l'administrateur
          const updateAdminQuery = `
    UPDATE administration
    SET nombre_consultation = nombre_consultation + 1
    WHERE code_admin = ?
  `;
          db.query(updateAdminQuery, [foundAdmin.code_admin], (err) => {
            if (err) {
              console.error(
                "Erreur lors de la mise à jour de nombre_consultation :",
                err
              );
              return db.rollback(() => {
                res.status(500).json({
                  message:
                    "Erreur lors de la mise à jour de nombre_consultation.",
                  error: err,
                });
              });
            }
            console.log("nombre_consultation mis à jour avec succès");
            // 8. Préparation des valeurs pour detaille_vente
            const detailleValues = medicamentsValides.map((med) => {
              if (!med.nom || !med.forme || !med.dosage) {
                throw new Error(
                  `Les informations du médicament (nom, forme, dosage) sont incomplètes.`
                );
              }
              return [
                id_vente,
                med.id_medicament,
                med.nom,
                med.forme,
                med.dosage,
                med.quantite_vendue,
                med.prix_unitaire || 0, // Par défaut 0 si prix manquant
              ];
            });

            const detailleQuery = `
    INSERT INTO detaille_vente 
    (id_vente, id_medicament, nom, forme, dosage, quantite_vendue, prix_unitaire)
    VALUES ?
  `;

            // 9. Insertion des détails de vente
            db.query(detailleQuery, [detailleValues], (err) => {
              if (err) {
                console.error("Erreur insertion détails de vente :", err);
                return db.rollback(() => {
                  res.status(500).json({
                    message:
                      "Erreur lors de l'insertion des détails de la vente.",
                    error: err,
                  });
                });
              }

              // 10. Mise à jour des stocks
              const stockUpdates = medicamentsValides.map((med) => {
                return new Promise((resolve, reject) => {
                  const stockQuery = `
          UPDATE stock_medicaments 
          SET stock_courant = stock_courant - ?
          WHERE id_medicament = ? AND stock_courant >= ?
        `;
                  db.query(
                    stockQuery,
                    [
                      med.quantite_vendue,
                      med.id_medicament,
                      med.quantite_vendue,
                    ],
                    (err, result) => {
                      if (err || result.affectedRows === 0) {
                        console.error(
                          "Erreur mise à jour stock ou stock insuffisant :",
                          med.nom
                        );
                        return reject(
                          new Error(
                            `Stock insuffisant pour le médicament : ${med.nom}`
                          )
                        );
                      }
                      resolve();
                    }
                  );
                });
              });

              // 11. Exécution des mises à jour de stock
              Promise.all(stockUpdates)
                .then(() => {
                  // Commit de la transaction après la mise à jour des stocks
                  db.commit((err) => {
                    if (err) {
                      console.error(
                        "Erreur validation de la transaction :",
                        err
                      );
                      return db.rollback(() => {
                        res.status(500).json({
                          message: "Erreur validation transaction.",
                          error: err,
                        });
                      });
                    }
                    res
                      .status(200)
                      .json({ message: "Vente enregistrée avec succès !" });
                  });
                })
                .catch((error) => {
                  db.rollback(() => {
                    console.error(
                      "Erreur lors de la mise à jour du stock :",
                      error.message
                    );
                    res.status(400).json({ message: error.message });
                  });
                });
            });
          });
        }
      );
    });
  });
});

app.get("/medicaments", (req, res) => {
  const { nom, forme, dosage } = req.query;

  let query = `
      SELECT sm.id_stock, sm.id_medicament, m.nom, m.forme, m.dosage, sm.prix_unitaire, sm.stock_courant, sm.date_peremption
      FROM stock_medicaments sm
      JOIN medicaments m ON sm.id_medicament = m.id_medicament
      WHERE 1=1
  `;
  const params = [];

  if (nom) {
    query += " AND m.nom = ?";
    params.push(nom);
  }

  if (forme) {
    query += " AND m.forme = ?";
    params.push(forme);
  }

  if (dosage) {
    query += " AND m.dosage = ?";
    params.push(dosage);
  }

  db.query(query, params, (err, results) => {
    if (err) {
      console.error(err);
      res.status(500).send("Erreur serveur");
    } else {
      res.json(results);
    }
  });
});

// Exemple de code côté backend
app.get("/get-prix", (req, res) => {
  const { nom, forme, dosage } = req.query;

  // Étape 1 : Log des paramètres reçus
  console.log("Paramètres reçus :", { nom, forme, dosage });

  // Étape 2 : Requête à la base de données
  db.query(
    "SELECT id_medicament, prix_unitaire FROM stock_medicaments WHERE nom = ? AND forme = ? AND dosage = ?",
    [nom, forme, dosage],
    (err, rows) => {
      if (err) {
        // Étape 3 : Gestion de l'erreur
        console.error("Erreur lors de la requête :", err);
        return res
          .status(500)
          .json({ message: "Erreur serveur.", erreur: err.message });
      }

      // Étape 4 : Vérification des résultats
      if (rows.length > 0) {
        res.json({
          id_medicament: rows[0].id_medicament,
          prix_unitaire: rows[0].prix_unitaire,
        });
      } else {
        console.warn("Aucun médicament trouvé pour les critères :", {
          nom,
          forme,
          dosage,
        });
        res.status(404).json({ message: "Médicament introuvable." });
      }
    }
  );
});

app.get("/vente", (req, res) => {
  // La requête SQL pour récupérer les informations de la table détaille_vente et le mode_paiement de la table vente
  const query = `
    SELECT dv.id_vente, dv.id_vente_detail, dv.nom, dv.forme, dv.dosage, dv.quantite_vendue, dv.prix_unitaire, 
           (dv.quantite_vendue * dv.prix_unitaire) AS montant_vente, v.mode_paiement
    FROM detaille_vente dv
    INNER JOIN vente v ON dv.id_vente = v.id_vente
  `;

  // Exécution de la requête SQL
  db.query(query, (err, results) => {
    if (err) {
      console.error(
        "Erreur lors de la récupération des données de la vente:",
        err
      );
      return res.status(500).send("Erreur interne du serveur");
    }

    // Envoi des résultats au client
    res.json(results);
  });
});

app.get("/ventes", (req, res) => {
  console.log("Requête reçue pour /ventes");
  const query = `SELECT * FROM vente`;
  db.query(query, (err, results) => {
    if (err) {
      console.error(
        "Erreur lors de la récupération des données de la vente:",
        err
      );
      return res.status(500).send("Erreur interne du serveur");
    }
    console.log("Résultats des ventes :", results);
    res.json(results);
  });
});

// Route pour récupérer les informations d'un médicament, y compris le prix unitaire
app.get("/medicament", (req, res) => {
  const { nom, forme, dosage } = req.query;

  // Vérifier que tous les paramètres sont fournis
  if (!nom || !forme || !dosage) {
    return res.status(400).json({
      error: "Les paramètres nom, forme et dosage sont obligatoires.",
    });
  }

  const sql = `
    SELECT 
      m.id_medicament, 
      sm.prix_unitaire
    FROM 
      medicaments AS m
    JOIN 
      stock_medicaments AS sm 
    ON 
      m.id_medicament = sm.id_medicament
    WHERE 
      m.nom = ? AND m.forme = ? AND m.dosage = ?
  `;

  db.query(sql, [nom, forme, dosage], (err, results) => {
    if (err) {
      console.error(
        "Erreur lors de la récupération des informations du médicament :",
        err
      );
      return res.status(500).json({ error: "Erreur serveur" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Médicament introuvable" });
    }

    res.json(results[0]); // On retourne uniquement le premier résultat s'il y en a plusieurs
  });
});

app.get("/medicaments/search", (req, res) => {
  const { name } = req.query;
  const query = `%${name}%`;
  const sql = "SELECT DISTINCT nom FROM medicaments WHERE nom LIKE ?";

  db.query(sql, [query], (err, results) => {
    if (err) {
      console.error(
        "Erreur lors de la récupération des noms de médicaments :",
        err
      );
      return res.status(500).json({ error: "Erreur serveur" });
    }
    console.log("Résultats des formes :", results); // Débogage
    res.json(results.map((row) => ({ nom: row.nom }))); // Changez ici pour renvoyer un tableau simple
  });
});

// Route pour récupérer les formes des médicaments
app.get("/formes/search", (req, res) => {
  const { name } = req.query;
  const query = `%${name}%`;
  const sql = "SELECT DISTINCT forme FROM medicaments WHERE forme LIKE ?";

  db.query(sql, [query], (err, results) => {
    if (err) {
      console.error("Erreur lors de la récupération des formes :", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    console.log("Résultats des formes :", results); // Débogage
    res.json(results.map((row) => ({ forme: row.forme })));
  });
});

// Route pour récupérer les dosages des médicaments
app.get("/dosages/search", (req, res) => {
  const { name } = req.query;
  const query = `%${name}%`;
  const sql = "SELECT DISTINCT dosage FROM medicaments WHERE dosage LIKE ?";

  db.query(sql, [query], (err, results) => {
    if (err) {
      console.error("Erreur lors de la récupération des dosages :", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    console.log("Résultats des dosages :", results); // Débogage
    res.json(results.map((row) => ({ dosage: row.dosage })));
  });
});

{
  /* FIN Pharmacie*/
}

{
  /* DEBUT Soins*/
}

// Route POST pour insérer un soin
app.post("/soins", (req, res) => {
  const { type_soin, prix, departement } = req.body;

  // **1. Validation des données**
  if (!type_soin || !prix || !departement) {
    return res.status(400).json({ message: "Tous les champs sont requis." });
  }

  if (isNaN(prix)) {
    return res
      .status(400)
      .json({ message: "Le prix doit être un nombre valide." });
  }

  // **2. Vérification si le département existe dans la table departments**
  const checkDepartementQuery =
    "SELECT id_departement FROM departements WHERE departement = ? LIMIT 1"; // On recherche le département

  db.query(checkDepartementQuery, [departement], (err, results) => {
    if (err) {
      console.error("Erreur lors de la vérification du département : ", err);
      return res.status(500).json({
        message: "Erreur serveur lors de la vérification du département.",
      });
    }

    if (results.length === 0) {
      return res.status(400).json({
        message:
          "Le département spécifié n'existe pas dans la table departments.",
      });
    }

    const id_departement = results[0].id_departement; // On récupère l'id_departement

    // **3. Vérification si le type de soin existe déjà dans la table soins**
    const checkSoinQuery = "SELECT 1 FROM soins WHERE type_soin = ? LIMIT 1";

    db.query(checkSoinQuery, [type_soin], (err, results) => {
      if (err) {
        console.error("Erreur lors de la vérification du soin : ", err);
        return res.status(500).json({
          message: "Erreur serveur lors de la vérification du soin.",
        });
      }

      if (results.length > 0) {
        return res.status(400).json({
          message: "Le soin existe déjà dans la base de données.",
        });
      }

      // **4. Insertion dans la table soins avec l'id_departement**
      const insertSoinsQuery =
        "INSERT INTO soins (type_soin, prix, id_departement) VALUES (?, ?, ?)"; // Utilisation de id_departement

      db.query(
        insertSoinsQuery,
        [type_soin, prix, id_departement], // On insère id_departement au lieu de departement
        (err, results) => {
          if (err) {
            console.error("Erreur lors de l'insertion des soins : ", err);
            return res.status(500).json({
              message: "Erreur serveur lors de l'insertion des soins.",
            });
          }

          return res.status(201).json({
            message: "Soins ajoutés avec succès",
            soinsId: results.insertId,
          });
        }
      );
    });
  });
});

// API pour récupérer les soins
app.get("/soins/:type_soin", (req, res) => {
  const { type_soin } = req.params;

  const checkSoinQuery = "SELECT 1 FROM soins WHERE type_soin = ? LIMIT 1";

  db.query(checkSoinQuery, [type_soin], (err, results) => {
    if (err) {
      console.error("Erreur lors de la vérification du soin : ", err);
      return res.status(500).json({
        message: "Erreur serveur lors de la vérification du soin.",
      });
    }

    const exists = results.length > 0;
    res.json({ exists });
  });
});

app.get("/soins", (req, res) => {
  // Requête SQL pour récupérer toutes les informations de la table soins sauf id_soin, et le nom du département
  const query = `
    SELECT s.id_soin, s.type_soin, s.prix, d.departement AS departement
    FROM soins s
    JOIN departements d ON s.id_departement = d.id_departement
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Erreur lors de la récupération des soins : ", err);
      return res.status(500).json({
        message: "Erreur serveur lors de la récupération des soins.",
      });
    }

    return res.status(200).json({
      message: "Soins récupérés avec succès.",
      soins: results,
    });
  });
});

app.delete("/delete_soins/:id", (req, res) => {
  const id = req.params.id;
  const sql = "DELETE FROM soins WHERE id_soin=?";
  const values = [id];
  db.query(sql, values, (err, result) => {
    if (err)
      return res.json({ message: "Something unexpected has occured" + err });
    return res.json({ success: "Student updated successfully" });
  });
});

{
  /* FIN Soins*/
}

{
  /* DEBUT Charges*/
}

// Route pour ajouter une charge
app.post("/ajouter-chrage", (req, res) => {
  const { charge, credit, description, date } = req.body;

  // Vérification des données reçues
  if (!charge || !credit || !date) {
    return res.status(400).json({
      error:
        "Veuillez fournir les champs obligatoires : charge, credit, et date.",
    });
  }

  // Requête SQL pour insérer les données
  const query = `INSERT INTO comptabilite (charge, credit, description, date) 
                 VALUES (?, ?, ?, ?)`;

  // Exécution de la requête
  db.query(
    query,
    [charge, credit, description || null, date], // Description est facultatif
    (err, result) => {
      if (err) {
        console.error("Erreur lors de l'insertion des données :", err);
        return res.status(500).json({ error: "Erreur serveur." });
      }

      res.status(201).json({
        message: "Entrée ajoutée avec succès.",
        id: result.insertId,
      });
    }
  );
});

app.get("/consultations/total/:year/:month", (req, res) => {
  const { year, month } = req.params;

  // Requête pour obtenir le montant total et la date maximale
  const query = `
      SELECT 
          SUM(montant) AS totalConsultations, 
          MAX(date) AS lastDate 
      FROM consultation 
      WHERE YEAR(date) = ? AND MONTH(date) = ?
  `;

  db.query(query, [year, month], (err, results) => {
    if (err) {
      console.error("Erreur lors de la requête SQL :", err);
      return res
        .status(500)
        .send("Erreur lors de la récupération des consultations");
    }

    const totalConsultations = results[0].totalConsultations || 0;
    const lastDate = results[0].lastDate || null;

    res.json({ totalConsultations, lastDate });
  });
});

app.get("/ventes/total/:year/:month", (req, res) => {
  const { year, month } = req.params;

  const query = `
      SELECT 
          SUM(montant_total) AS totalVentes, 
          MAX(date) AS lastDate 
      FROM vente 
      WHERE YEAR(date) = ? AND MONTH(date) = ?
  `;

  db.query(query, [year, month], (err, results) => {
    if (err) {
      console.error("Erreur lors de la requête SQL :", err);
      return res.status(500).send("Erreur lors de la récupération des ventes");
    }

    const totalVentes = results[0]?.totalVentes || 0;
    const lastDate = results[0]?.lastDate || null;

    res.json({ totalVentes, lastDate });
  });
});

// Route pour récupérer toutes les entrées ou une entrée spécifique
app.get("/charges/:year/:month", (req, res) => {
  const { year, month } = req.params;

  // Construction de la requête SQL avec filtrage par année et mois
  const sql = `
    SELECT * 
    FROM comptabilite
    WHERE YEAR(date) = ? AND MONTH(date) = ?
  `;

  db.query(sql, [year, month], (err, result) => {
    if (err) {
      console.error("Erreur SQL :", err);
      return res.status(500).json({ message: "Erreur serveur" });
    }

    console.log("Résultats de la requête : ", result); // Log des résultats
    res.json(result); // Renvoie les résultats sous forme de JSON
  });
});

// Route pour récupérer le total des achats et la dernière date du mois
app.get("/historique_achats/:year/:month", (req, res) => {
  const { year, month } = req.params;
  console.log(`Année: ${year}, Mois: ${month}`); // Vérifiez les valeurs dans la console

  // Requête SQL pour récupérer les achats et calculer le total
  const query = `
      SELECT
          MAX(date_achat) AS last_date,
          SUM(quantite * prix_achat) AS total_achats
      FROM historique_achats
      WHERE YEAR(date_achat) = ? AND MONTH(date_achat) = ?
  `;

  // Exécution de la requête SQL
  db.query(query, [year, month], (err, results) => {
    if (err) {
      console.error("Erreur lors de l'exécution de la requête:", err);
      return res.status(500).json({ message: "Erreur serveur" });
    }

    // Si aucun résultat n'est trouvé, renvoyer une réponse appropriée
    if (results.length === 0 || results[0].last_date === null) {
      return res
        .status(404)
        .json({ message: "Aucun achat trouvé pour cette période" });
    }

    // Renvoi de la dernière date et du total des achats
    const lastDate = results[0].last_date;
    const totalAchats = results[0].total_achats;

    res.json({
      lastDate: lastDate,
      totalAchats: totalAchats,
    });
  });
});

// Route pour récupérer le total des paiements par mois et année
app.get("/paiements/total/:year/:month", async (req, res) => {
  const { year, month } = req.params;

  try {
    db.query(
      `SELECT 
         SUM(s.salaire_brute + p.prime + p.sur_salaire) AS totalPaiement,
         MAX(p.date_paiement) AS lastDate
       FROM paiement p
       JOIN salaire s ON p.id_salaire = s.id_salaire
       WHERE MONTH(p.date_paiement) = ? AND YEAR(p.date_paiement) = ?`,
      [month, year],
      (error, results) => {
        if (error) {
          console.error("Erreur lors de l’exécution de la requête :", error);
          res.status(500).send("Erreur serveur");
          return;
        }

        // Récupérer les valeurs de totalPaiement et lastDate
        const totalPaiement = results[0]?.totalPaiement || 0; // Retourne 0 si aucune donnée
        const lastDate = results[0].lastDate; // Retourne null si aucune date
        res.json({ totalPaiement, lastDate });
      }
    );
  } catch (error) {
    console.error("Erreur lors de la récupération des paiements:", error);
    res.status(500).send("Erreur serveur");
  }
});

{
  /* FIN Charges*/
}

app.get("/medecin/:departement", async (req, res) => {
  const { departement } = req.params;
  try {
    const [result] = await db.query(
      "SELECT prenom, nom, profil FROM administration WHERE departement = ? LIMIT 1",
      [departement]
    );
    if (result) {
      const { prenom, nom, profil } = result;

      // Convertir l'image binaire en Base64
      const base64Image = profil
        ? `data:image/jpeg;base64,${Buffer.from(profil).toString("base64")}`
        : null;

      res.json({ prenom, nom, profil: base64Image });
    } else {
      res.status(404).json({ message: "Médecin non trouvé" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Route pour rechercher les départements
app.get("/departements/search", (req, res) => {
  const { name } = req.query;
  const query = `%${name}%`;
  const sql =
    "SELECT DISTINCT departement FROM departements WHERE departement LIKE ?";

  db.query(sql, [query], (err, results) => {
    if (err) {
      console.error("Erreur lors de la récupération des dosages :", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    console.log("Résultats des dosages :", results); // Débogage
    res.json(results.map((row) => ({ departement: row.departement })));
  });
});

// Servir les fichiers statiques de l'application React après les routes API
//app.use(express.static(path.join(__dirname, 'build')));

// Route pour gérer toutes les autres requêtes (frontend React)
//app.get('*', (req, res) => {
//  res.sendFile(path.join(__dirname, 'build', 'index.html'));
//});

app.listen(port, () => {
  console.log(`Serveur en écoute sur le port ${port}`);
});
