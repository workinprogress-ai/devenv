echo "# Installing mongo db compass"
echo "#############################################"

arch=$(uname -m)
is_arm=$([ "$arch" == "aarch64" ] && echo 1)

mkdir -p $devenv/.installs
cd $devenv/.installs

if [ "$is_arm" == "1" ]; then
    echo "ARM:  Cannot install MongoDbCompass"
else
    if [ ! -f /tmp/mongodb-compass.deb ]; then
        wget -O ./mongodb-compass.deb https://downloads.mongodb.com/compass/mongodb-compass_1.43.5_amd64.deb
    fi
    sudo apt install -y /tmp/mongodb-compass.deb
fi
