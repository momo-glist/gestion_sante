# Utiliser une image de Node.js avec une version spécifique
FROM node:18

# Installer les dépendances pour compiler bcrypt
RUN apt-get update && apt-get install -y \
  build-essential \
  python3

# Définir le répertoire de travail dans le container
WORKDIR /usr/src/app

# Copier les fichiers package.json et package-lock.json
COPY package*.json ./

# Installer les dépendances
RUN npm install

# Copier le reste des fichiers de l'application
COPY . .

# Exposer le port sur lequel le backend écoute
EXPOSE 5001

# Commande pour démarrer l'application
CMD ["npm", "start"]