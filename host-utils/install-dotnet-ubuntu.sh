
# cat <<EOF >>./99microsoft-dotnet.pref
# Package: *
# Pin: origin "packages.microsoft.com"
# Pin-Priority: 1001
# EOF
# sudo mv ./99microsoft-dotnet.pref /etc/apt/preferences.d/

sudo apt update
sudo apt install dotnet-sdk-6.0 -y
sudo apt install dotnet-sdk-7.0 -y
sudo apt install dotnet-sdk-8.0 -y

