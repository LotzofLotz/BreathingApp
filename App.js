import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableWithoutFeedback, Button, Alert, TouchableOpacity} from 'react-native';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useKeepAwake } from 'expo-keep-awake';


export default function App() {
  const [sessionData, setSessionData] = useState([])
  const [retentionDurations, setRetentionDurations] = useState([]);
const [finished, setFinished] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [currentPhase, setCurrentPhase] = useState('idle'); // idle, breathing, retention, pause
  const [retentionTimer, setRetentionTimer] = useState(0);
  const timerIntervalRef = useRef(null);
  const pauseTimeoutRef = useRef(null);
  const breathingSound = useRef(new Audio.Sound());
  const retentionSound = useRef(new Audio.Sound());
  const doubleTapRef = useRef(null);
  const [breathingSpeed, setBreathingSpeed] = useState(1.0)
  
  const currentPhaseRef = useRef(currentPhase);
useEffect(() => {
  currentPhaseRef.current = currentPhase;
}, [currentPhase]);


  // Audiodateien laden
  useEffect(() => {
    const loadSounds = async () => {
      try {
        await breathingSound.current.loadAsync(require('./assets/audios/breathingAudio.mp3'));
        await retentionSound.current.loadAsync(require('./assets/audios/retentionAudio.mp3'));
      } catch (error) {
        Alert.alert("Error", "Fehler beim Laden der Audiodateien.");
      }
    };
    loadSounds();

    // Ressourcen beim Unmount freigeben
    return () => {
      breathingSound.current.unloadAsync();
      retentionSound.current.unloadAsync();
      clearInterval(timerIntervalRef.current);
    };
  }, []);



  const handleSaveResults = async () => {
    if (retentionDurations.length === 0) {
      Alert.alert('Fehler', 'Keine Daten zum Speichern vorhanden.');
      return;
    }
    
    const timestamp = new Date().toISOString();
    const totalTime = retentionDurations.reduce((sum, t) => sum + t, 0);
    const averageTime = totalTime / retentionDurations.length;
    
    const resultData = {
      timestamp,
      rounds: retentionDurations, // Array mit den einzelnen Runden in Sekunden
      averageRetention: averageTime, // Durchschnitt in Sekunden
    };
  
    try {
      // Bestehende Daten abrufen
      const existingDataJson = await AsyncStorage.getItem('breathingExerciseResults');
      let allResults = [];
      
      if (existingDataJson) {
        try {
          // Versuchen, die existierenden Daten zu parsen
          allResults = JSON.parse(existingDataJson);
          
          // Sicherstellen, dass es ein Array ist
          if (!Array.isArray(allResults)) {
            allResults = [allResults]; // Falls es nur ein Objekt war
          }
        } catch (parseError) {
          console.error("Fehler beim Parsen der gespeicherten Daten:", parseError);
          allResults = []; // Zurücksetzen bei Parsefehler
        }
      }
      
      // Neue Ergebnisse hinzufügen
      allResults.push(resultData);
      
      // Alle Ergebnisse speichern
      await AsyncStorage.setItem('breathingExerciseResults', JSON.stringify(allResults));
      Alert.alert('Erfolg', 'Ergebnisse wurden gespeichert.');
      
      // App zurücksetzen für neue Übung
      resetApp();
    } catch (error) {
      console.error("Speicherfehler:", error);
      Alert.alert('Fehler', 'Ergebnisse konnten nicht gespeichert werden.');
    }
  };

  // Funktion zum Zurücksetzen der App nach dem Speichern
  const resetApp = () => {
    setRetentionDurations([]);
    setFinished(false);
    setCurrentPhase('idle');
  };

  // Starte die Runde
  const startRound = async () => {
    setIsRunning(true);
    setCurrentPhase('breathing');
    try {
      // Breathing Audio abspielen
      await breathingSound.current.setRateAsync(breathingSpeed, true);
      await breathingSound.current.replayAsync();
      // Setze Callback für das Ende der Audio-Wiedergabe
      breathingSound.current.setOnPlaybackStatusUpdate(status => {
        if (status.didJustFinish && currentPhaseRef.current === 'breathing') {
          startRetention();
        }
      });
    } catch (error) {
      Alert.alert("Error", "Fehler beim Abspielen der breathingAudio.");
    }
  };

  // Wechselt in die Retention-Phase
  const startRetention = async () => {
    // Timer zurücksetzen
    setRetentionTimer(0);
    clearInterval(timerIntervalRef.current);
    setCurrentPhase('retention');
    try {
      await retentionSound.current.replayAsync();
      // Timer starten (aktualisiert jede Sekunde)
      timerIntervalRef.current = setInterval(() => {
        setRetentionTimer(prev => prev + 1);
      }, 1000);
    } catch (error) {
      Alert.alert("Error", "Fehler beim Abspielen der retentionAudio.");
    }
  };

  // Beendet die Retention-Phase per Doppeltap oder direkt aus der Breathing-Phase
  const handleDoubleTap = async () => {
    // Wenn in Breathing-Phase: Wechsle direkt in Retention (Frühstart)
    if (currentPhase === 'breathing') {
      try {
        await breathingSound.current.stopAsync();
      } catch (error) {
        console.log("Error beim Stoppen der breathingAudio:", error);
      }
      startRetention();
      return;
    }
    // In der Retention-Phase: Beende die Phase und starte Pause
    if (currentPhase === 'retention') {
      try {
        await retentionSound.current.stopAsync();
      } catch (error) {
        console.log("Error beim Stoppen der retentionAudio:", error);
      }
      clearInterval(timerIntervalRef.current);
      setRetentionDurations(prev => [...prev, retentionTimer]);
      setCurrentPhase('pause');
      pauseTimeoutRef.current = setTimeout(() => {
        // Überprüfen, ob die Session noch läuft:
        if (!isRunning) return;
        startRound();
      }, 15000);
    }
  };

  // Beendet die gesamte Session während der Breathing-Phase über den Finish-Button
  const finishSession = async () => {
    // Falls gerade in der Retention-Phase, auch die aktuelle Zeit aufzeichnen.
    if (currentPhase === 'retention') {
      try {
        await retentionSound.current.stopAsync();
      } catch (error) {
        console.log("Error beim Stoppen der retentionAudio:", error);
      }
      clearInterval(timerIntervalRef.current);
      setRetentionDurations(prev => [...prev, retentionTimer]);
    } else if (currentPhase === 'breathing') {
      try {
        await breathingSound.current.stopAsync();
      } catch (error) {
        console.log("Error beim Stoppen der breathingAudio:", error);
      }
    }
    else if (currentPhase === 'pause') {
      // Falls wir in der Pause sind und noch keine Runde erfasst wurde,
      // aber der retentionTimer einen Wert > 0 hat, dann erfassen wir diesen Wert.
      if (retentionDurations.length === 0 && retentionTimer > 0) {
        setRetentionDurations([retentionTimer]);
      }
    }
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
      pauseTimeoutRef.current = null;
    }
    setIsRunning(false);
    setCurrentPhase('idle');
    setFinished(true);
  };

  // Einfacher Doppeltap-Detektor (300ms Schwelle)
  const handleTap = () => {
    const now = Date.now();
    if (doubleTapRef.current && now - doubleTapRef.current < 300) {
      handleDoubleTap();
    }
    doubleTapRef.current = now;
  };

  // Formatierung des Timers im Format MM:SS
  const formatTime = seconds => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const chartData = {
    labels: sessionData.map(session => new Date(session.timestamp).toLocaleDateString()),
    datasets: [
      {
        data: sessionData.map(session => session.averageRetention)
      }
    ]
  };

  useKeepAwake();

  return (
    <TouchableWithoutFeedback onPress={handleTap}>
      <View style={styles.container}>
      {currentPhase === 'idle' && !finished && (
          <View style={styles.chartContainer}>
            {sessionData.length > 0 ? (
              <BarChart
                data={chartData}
                width={Dimensions.get('window').width - 30}
                height={220}
                yAxisLabel=""
                chartConfig={{
                  backgroundColor: "#fff",
                  backgroundGradientFrom: "#fff",
                  backgroundGradientTo: "#fff",
                  decimalPlaces: 1,
                  color: (opacity = 1) => `rgba(0, 122, 255, ${opacity})`,
                  style: {
                    borderRadius: 16
                  }
                }}
                style={{
                  marginVertical: 8,
                  borderRadius: 16
                }}
              />
            ) : (
              <Text style={styles.noDataText}>Keine Sessions verfügbar</Text>
            )}
          </View>
        )}


        {currentPhase === 'idle' && !finished &&(
        <View style={styles.idleContainer}>
        <Text style={styles.label}>BreathingSpeed:</Text>
        <View style={styles.optionsContainer}>
          <TouchableOpacity
            style={[
              styles.optionButton,
              breathingSpeed === 1.0 && styles.optionButtonSelected,
            ]}
            onPress={() => setBreathingSpeed(1.0)}
          >
            <Text style={styles.optionText}>Normal</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.optionButton,
              breathingSpeed === 1.2 && styles.optionButtonSelected,
            ]}
            onPress={() => setBreathingSpeed(1.2)}
          >
            <Text style={styles.optionText}>Quick</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.startButton} onPress={startRound}>
          <Text style={styles.startButtonText}>Start</Text>
        </TouchableOpacity>
      </View>
        )}
        {isRunning && (
                 <View style={styles.finishContainer}>
                 <Button title="Finish" onPress={finishSession} />
               </View>
       
        )}
        {currentPhase === 'breathing' && (
          <View style={styles.phaseContainer}>
            <Text style={styles.phaseText}>Atme tief ein...</Text>
          </View>
        )}
        {currentPhase === 'retention' && (
          <View style={styles.phaseContainer}>
            <Text style={styles.phaseText}>Luft anhalten (Doppeltap um zu beenden)</Text>
            <Text style={styles.timerText}>{formatTime(retentionTimer)}</Text>
          </View>
        )}
        {currentPhase === 'pause' && (
          <Text style={styles.phaseText}>Pause... Nächste Runde startet in 15 Sekunden</Text>
        )}
        {finished && retentionDurations.length > 0 && (
        <View style={styles.resultsContainer}>
          {retentionDurations.map((duration, index) => (
            <Text key={index} style={styles.resultText}>
              Runde {index + 1}: {formatTime(duration)}
            </Text>
          ))}
           <TouchableOpacity style={styles.startButton} onPress={handleSaveResults}>
          <Text style={styles.startButtonText}>Save</Text>
        </TouchableOpacity>
         
        </View>
      )}
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseContainer: {
    alignItems: 'center',
  },
  phaseText: {
    fontSize: 20,
    textAlign: 'center',
    margin: 20,
  },
  timerText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  resultsContainer: {
    marginTop: 30,
    alignItems: 'center',
  },
  resultText: {
    fontSize: 18,
    marginVertical: 4,
  },
  finishContainer: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 10,
  },
 
  startButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  idleContainer: {
    alignItems: 'center',
  },
  label: {
    fontSize: 18,
    marginBottom: 10,
  },
  optionsContainer: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  optionButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#eee',
    borderRadius: 5,
    marginHorizontal: 5,
  },
  optionButtonSelected: {
    backgroundColor: '#007AFF',
  },
  optionText: {
    fontSize: 16,
    color: '#333',
  },
  startButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 20,
    paddingHorizontal: 40,
    borderRadius: 10,
    elevation: 3,
  },
});
