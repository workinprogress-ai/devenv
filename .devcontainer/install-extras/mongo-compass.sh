echo "# Installing mongo db compass"
echo "#############################################"
is_arm=$([ "$arch" == "aarch64" ] && echo 1)

if [ "$is_arm" == "1" ]; then
    echo "ARM:  Cannot install MongoDbCompass"
else
    wget -O /tmp/mongodb-compass.deb https://downloads.mongodb.com/compass/mongodb-compass_1.43.5_amd64.deb
    sudo apt install -y /tmp/mongodb-compass.deb
    rm /tmp/mongodb-compass.deb
fi
